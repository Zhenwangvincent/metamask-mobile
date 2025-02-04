import React, { PureComponent } from 'react';
import PropTypes from 'prop-types';
import { TouchableOpacity, Dimensions, StyleSheet, View, Text, Clipboard } from 'react-native';
import { colors, fontStyles } from '../../../styles/common';
import { toChecksumAddress } from 'ethereumjs-util';
import { connect } from 'react-redux';
import QRCode from 'react-native-qrcode-svg';
import { strings } from '../../../../locales/i18n';
import IonicIcon from 'react-native-vector-icons/Ionicons';
import DeviceSize from '../../../util/DeviceSize';
import { showAlert } from '../../../actions/alert';
import GlobalAlert from '../../UI/GlobalAlert';

const WIDTH = Dimensions.get('window').width - 88;

const styles = StyleSheet.create({
	root: {
		flex: 1,
		flexDirection: 'row',
		alignItems: 'center',
		marginTop: DeviceSize.isSmallDevice() ? -30 : -50
	},
	wrapper: {
		flex: 1,
		alignItems: 'center'
	},
	qrCode: {
		marginBottom: 16,
		alignItems: 'center',
		justifyContent: 'center',
		padding: 36,
		backgroundColor: colors.grey000,
		borderRadius: 8
	},
	addressWrapper: {
		alignItems: 'center',
		justifyContent: 'center',
		width: WIDTH,
		borderRadius: 8,
		backgroundColor: colors.grey000,
		paddingVertical: 12
	},
	closeIcon: {
		width: WIDTH + 40,
		paddingBottom: DeviceSize.isSmallDevice() ? 30 : 50,
		flexDirection: 'row-reverse'
	},
	addressTitle: {
		fontSize: 16,
		paddingHorizontal: 28,
		paddingVertical: 4,
		...fontStyles.normal
	},
	address: {
		...fontStyles.normal,
		paddingHorizontal: 28,
		paddingVertical: 4,
		fontSize: 16,
		textAlign: 'center'
	}
});

/**
 * PureComponent that renders a public address view
 */
class AddressQRCode extends PureComponent {
	static propTypes = {
		/**
		 * Selected address as string
		 */
		selectedAddress: PropTypes.string,
		/**
		/* Triggers global alert
		*/
		showAlert: PropTypes.func,
		/**
		/* Callback to close the modal
		*/
		closeQrModal: PropTypes.func
	};

	/**
	 * Closes QR code modal
	 */
	closeQrModal = () => {
		const { closeQrModal } = this.props;
		closeQrModal && closeQrModal();
	};

	copyAccountToClipboard = async () => {
		const { selectedAddress } = this.props;
		await Clipboard.setString(selectedAddress);
		this.props.showAlert({
			isVisible: true,
			autodismiss: 1500,
			content: 'clipboard-alert',
			data: { msg: strings('account_details.account_copied_to_clipboard') }
		});
	};

	processAddress = () => {
		const { selectedAddress } = this.props;
		const processedAddress = `${selectedAddress.slice(0, 2)} ${selectedAddress
			.slice(2)
			.match(/.{1,4}/g)
			.join(' ')}`;
		return processedAddress;
	};

	render() {
		return (
			<View style={styles.root}>
				<View style={styles.wrapper}>
					<TouchableOpacity style={styles.closeIcon} onPress={this.closeQrModal}>
						<IonicIcon name={'ios-close'} size={38} color={colors.white} />
					</TouchableOpacity>
					<View style={styles.qrCode}>
						<QRCode
							value={`ethereum:${this.props.selectedAddress}`}
							size={Dimensions.get('window').width - 160}
						/>
					</View>
					<View style={styles.addressWrapper}>
						<Text style={styles.addressTitle}>{strings('receive_request.public_address_qr_code')}</Text>
						<TouchableOpacity onPress={this.copyAccountToClipboard}>
							<Text style={styles.address}>{this.processAddress()}</Text>
						</TouchableOpacity>
					</View>
				</View>
				<GlobalAlert />
			</View>
		);
	}
}

const mapStateToProps = state => ({
	selectedAddress: toChecksumAddress(state.engine.backgroundState.PreferencesController.selectedAddress)
});

const mapDispatchToProps = dispatch => ({
	showAlert: config => dispatch(showAlert(config))
});

export default connect(
	mapStateToProps,
	mapDispatchToProps
)(AddressQRCode);
