import RNWalletConnect from '@walletconnect/react-native';
import Engine from './Engine';
import { Linking } from 'react-native';
import Logger from '../util/Logger';
// eslint-disable-next-line import/no-nodejs-modules
import { EventEmitter } from 'events';
import AsyncStorage from '@react-native-community/async-storage';

const hub = new EventEmitter();
let connectors = [];
let pendingRedirect = null;

const CLIENT_OPTIONS = {
	clientMeta: {
		// Required
		description: 'MetaMask Mobile app',
		url: 'https://metamask.io',
		icons: ['https://raw.githubusercontent.com/MetaMask/brand-resources/master/SVG/metamask-fox.svg'],
		name: 'MetaMask',
		ssl: true
	}
};

const persistSessions = async () => {
	const sessions = connectors
		.filter(connector => connector && connector.walletConnector && connector && connector.walletConnector.connected)
		.map(connector => connector.walletConnector.session);

	await AsyncStorage.setItem('@MetaMask:walletconnectSessions', JSON.stringify(sessions));
};

class WalletConnect {
	selectedAddress = null;
	chainId = null;
	redirect = null;
	autosign = false;

	constructor(options) {
		if (options.redirect) {
			pendingRedirect = options.redirect;
		}

		if (options.autosign) {
			this.autosign = true;
		}
		this.walletConnector = new RNWalletConnect(options, CLIENT_OPTIONS);
		/**
		 *  Subscribe to session requests
		 */
		this.walletConnector.on('session_request', async (error, payload) => {
			if (error) {
				throw error;
			}

			try {
				const sessionData = {
					...payload.params[0],
					autosign: this.autosign
				};
				Logger.log('requesting session with', sessionData);
				await this.sessionRequest(sessionData);

				const { network } = Engine.context.NetworkController.state;
				this.selectedAddress = Engine.context.PreferencesController.state.selectedAddress;
				const approveData = {
					chainId: parseInt(network, 10),
					accounts: [this.selectedAddress]
				};
				await this.walletConnector.approveSession(approveData);
				persistSessions();
				this.redirectIfNeeded();
			} catch (e) {
				this.walletConnector.rejectSession();
			}
		});

		/**
		 *  Subscribe to call requests
		 */
		this.walletConnector.on('call_request', async (error, payload) => {
			Logger.log('CALL_REQUEST', error, payload);
			if (error) {
				throw error;
			}

			const meta = this.walletConnector.session.peerMeta;

			if (payload.method) {
				if (payload.method === 'eth_sendTransaction') {
					const { TransactionController } = Engine.context;
					try {
						const txParams = {};
						txParams.to = payload.params[0].to;
						txParams.from = payload.params[0].from;
						txParams.value = payload.params[0].value;
						txParams.gasLimit = payload.params[0].gasLimit;
						txParams.gasPrice = payload.params[0].gasPrice;
						txParams.data = payload.params[0].data;

						const hash = await (await TransactionController.addTransaction(txParams)).result;
						this.walletConnector.approveRequest({
							id: payload.id,
							result: hash
						});
					} catch (error) {
						this.walletConnector.rejectRequest({
							id: payload.id,
							error
						});
					}
				} else if (payload.method === 'eth_sign') {
					const { MessageManager } = Engine.context;
					let rawSig = null;
					try {
						if (payload.params[2]) {
							throw new Error('Autosign is not currently supported');
							// Leaving this in case we want to enable it in the future
							// once WCIP-4 is defined: https://github.com/WalletConnect/WCIPs/issues/4
							// rawSig = await KeyringController.signPersonalMessage({
							// 	data: payload.params[1],
							// 	from: payload.params[0]
							// });
						} else {
							const data = payload.params[1];
							const from = payload.params[0];

							rawSig = await MessageManager.addUnapprovedMessageAsync({
								data,
								from,
								meta: {
									title: meta && meta.name,
									url: meta && meta.url,
									icon: meta && meta.icons && meta.icons[0]
								}
							});
						}
						this.walletConnector.approveRequest({
							id: payload.id,
							result: rawSig
						});
					} catch (error) {
						this.walletConnector.rejectRequest({
							id: payload.id,
							error
						});
					}
				} else if (payload.method === 'personal_sign') {
					const { PersonalMessageManager } = Engine.context;
					let rawSig = null;
					try {
						if (payload.params[2]) {
							throw new Error('Autosign is not currently supported');
							// Leaving this in case we want to enable it in the future
							// once WCIP-4 is defined: https://github.com/WalletConnect/WCIPs/issues/4
							// rawSig = await KeyringController.signPersonalMessage({
							// 	data: payload.params[1],
							// 	from: payload.params[0]
							// });
						} else {
							const data = payload.params[0];
							const from = payload.params[1];

							rawSig = await PersonalMessageManager.addUnapprovedMessageAsync({
								data,
								from,
								meta: {
									title: meta && meta.name,
									url: meta && meta.url,
									icon: meta && meta.icons && meta.icons[0]
								}
							});
						}
						this.walletConnector.approveRequest({
							id: payload.id,
							result: rawSig
						});
					} catch (error) {
						this.walletConnector.rejectRequest({
							id: payload.id,
							error
						});
					}
				} else if (payload.method && payload.method === 'eth_signTypedData') {
					const { TypedMessageManager } = Engine.context;
					try {
						const rawSig = await TypedMessageManager.addUnapprovedMessageAsync(
							{
								data: payload.params[1],
								from: payload.params[0],
								meta: {
									title: meta && meta.name,
									url: meta && meta.url,
									icon: meta && meta.icons && meta.icons[0]
								}
							},
							'V3'
						);

						this.walletConnector.approveRequest({
							id: payload.id,
							result: rawSig
						});
					} catch (error) {
						this.walletConnector.rejectRequest({
							id: payload.id,
							error
						});
					}
				}
			}
		});

		this.walletConnector.on('disconnect', error => {
			if (error) {
				throw error;
			}

			// delete walletConnector
			this.walletConnector = null;
			persistSessions();
		});

		this.walletConnector.on('session_update', (error, payload) => {
			Logger.log('WC: Session update', payload);
			if (error) {
				throw error;
			}
		});

		Engine.context.TransactionController.hub.on('networkChange', this.onNetworkChange);
		Engine.context.PreferencesController.subscribe(this.onAccountChange);
		const { selectedAddress } = Engine.context.PreferencesController.state;
		const { network } = Engine.context.NetworkController.state;

		this.selectedAddress = selectedAddress;
		this.chainId = network;
	}

	onAccountChange = () => {
		const { selectedAddress } = Engine.context.PreferencesController.state;

		if (selectedAddress !== this.selectedAddress) {
			this.selectedAddress = selectedAddress;
			this.updateSession();
		}
	};

	onNetworkChange = () => {
		const { network } = Engine.context.NetworkController.state;
		// Wait while the network is set
		if (network !== 'loading' && network !== this.chainId) {
			this.chainId = network;
			this.updateSession();
		}
	};

	updateSession = () => {
		const { network } = Engine.context.NetworkController.state;
		const { selectedAddress } = Engine.context.PreferencesController.state;
		const sessionData = {
			chainId: parseInt(network, 10),
			accounts: [selectedAddress]
		};
		try {
			this.walletConnector.updateSession(sessionData);
		} catch (e) {
			Logger.log('Error while updating session', e);
		}
	};

	killSession = () => {
		this.walletConnector && this.walletConnector.killSession();
		this.walletConnector = null;
	};

	sessionRequest = peerInfo =>
		new Promise((resolve, reject) => {
			hub.emit('walletconnectSessionRequest', peerInfo);

			hub.on('walletconnectSessionRequest::approved', peerId => {
				if (peerInfo.peerId === peerId) {
					resolve(true);
				}
			});
			hub.on('walletconnectSessionRequest::rejected', peerId => {
				if (peerInfo.peerId === peerId) {
					reject(false);
				}
			});
		});

	redirectIfNeeded = () => {
		if (pendingRedirect) {
			setTimeout(() => {
				Linking.openURL(pendingRedirect);
				pendingRedirect = null;
			}, 500);
		}
	};
}

const instance = {
	async init() {
		const sessionData = await AsyncStorage.getItem('@MetaMask:walletconnectSessions');
		if (sessionData) {
			const sessions = JSON.parse(sessionData);
			sessions.forEach(session => {
				connectors.push(new WalletConnect({ session }));
			});
		}
	},
	connectors() {
		return connectors;
	},
	newSession(uri, redirect, autosign) {
		const data = { uri };
		if (redirect) {
			data.redirect = redirect;
		}
		if (autosign) {
			data.autosign = autosign;
		}
		connectors.push(new WalletConnect(data));
	},
	getSessions: async () => {
		let sessions = [];
		const sessionData = await AsyncStorage.getItem('@MetaMask:walletconnectSessions');
		if (sessionData) {
			sessions = JSON.parse(sessionData);
		}
		return sessions;
	},
	killSession: async id => {
		// 1) First kill the session
		const connectorToKill = connectors.find(
			connector => connector && connector.walletConnector && connector.walletConnector.session.peerId === id
		);
		if (connectorToKill) {
			await connectorToKill.killSession();
		}
		// 2) Remove from the list of connectors
		connectors = connectors.filter(
			connector =>
				connector &&
				connector.walletConnector &&
				connector.walletConnector.connected &&
				connector.walletConnector.session.peerId !== id
		);
		// 3) Persist the list
		await persistSessions();
	},
	hub,
	shutdown() {
		Engine.context.TransactionController.hub.removeAllListeners();
		Engine.context.PreferencesController.unsubscribe();
	},
	setRedirectUri: uri => {
		pendingRedirect = uri;
	}
};

export default instance;
