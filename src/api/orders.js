import { get } from 'svelte/store'
import { ADDRESS_ZERO, BPS_DIVIDER, CURRENCY_DECIMALS } from '@lib/config'
import { getContract } from '@lib/contracts'
import { parseUnits, createOrderTuple } from '@lib/formatters'
import { address, marketInfos, orders, selectedMarket, selectedMarketInfo, selectedAsset, margin, size, price, isReduceOnly, isLong, isProtectedOrder, tpPrice, slPrice, submittingOrder, hasTrigger, hasTP, hasSL, prices } from '@lib/stores'
import { showToast, showError, hideModal } from '@lib/ui'
import { getLabelForAsset, getAssetAddress } from '@lib/utils'

let isLoadingOrders = false;
export async function getUserOrders() {
	// console.log('called getUserOrders');
	if (!get(address) || isLoadingOrders) return false;
	isLoadingOrders = true;
	const contract = await getContract('OrderStore');
	let _orders = [...await contract.getUserOrders(get(address))];
	_orders.reverse();
	// console.log('orders', _orders);
	orders.set(_orders);
	isLoadingOrders = false;
	return true;
}

export async function cancelOrder(orderId) {
	const contract = await getContract('Orders', true);
	try {
		let tx = await contract.cancelOrder(orderId);
		let receipt = await tx.wait();
		if (receipt && receipt.status == 1) {
			showToast('Order cancelled.', 1);
			// getUserOrders();
			return true;
		}
		return false;
	} catch(e) {
		showError(e);
	}
}

export function orderSubmitted() {
	if (!get(submittingOrder)) return;
	submittingOrder.set(false);
	showToast('Order submitted.', 1);
	// clear values
	size.set();
	price.set();
	tpPrice.set();
	slPrice.set();
	isReduceOnly.set(false);
	hasTrigger.set(false);
	hasTP.set(false);
	hasSL.set(false);
	isProtectedOrder.set(false);
}

export function closeOrderSubmitted() {
	showToast('Close order submitted.', 1);
	hideModal();
}

export async function submitOrder() {

	submittingOrder.set(true);

	const contract = await getContract('Orders', true);

	// console.log('contract', contract);
	
	// Params
	const market = get(selectedMarket);
	const marketInfo = get(selectedMarketInfo);

	const _asset = get(selectedAsset);
	const asset = getAssetAddress(_asset);
	const assetDecimals = CURRENCY_DECIMALS[_asset];

	const _isLong = get(isLong);

	let cleaningDecimals = 10;
	if (_asset == 'USDC') {
		cleaningDecimals = 6;
	}
	let marginCleaned = (Math.ceil(get(margin) * 10**cleaningDecimals) / 10**cleaningDecimals).toFixed(cleaningDecimals);
	let sizeCleaned = (Math.floor(get(size) * 10**cleaningDecimals) / 10**cleaningDecimals).toFixed(cleaningDecimals);

	// If leverage > max leverage, adjust margin
	let leverage = sizeCleaned / marginCleaned;
	if (leverage > marketInfo.maxLeverage * 1) {
		marginCleaned = (Math.ceil(sizeCleaned * 10**cleaningDecimals / (marketInfo.maxLeverage * 1)) / 10**cleaningDecimals).toFixed(cleaningDecimals);
	}

	// console.log('marginCleaned', marginCleaned);
	// console.log('sizeCleaned', sizeCleaned);

	let _margin = parseUnits(marginCleaned, assetDecimals);
	const _size = parseUnits(sizeCleaned, assetDecimals);

	let _priceRaw = get(price);
	let _price = parseUnits(_priceRaw);
	const _hasTrigger = get(hasTrigger);
	const _isReduceOnly = get(isReduceOnly);
	const _isProtectedOrder = get(isProtectedOrder);

	if (!_hasTrigger && !_isProtectedOrder) {
		_price = parseUnits(0);
	}

	if (_isReduceOnly) {
		_margin = parseUnits(0);
	}

	let orderType = 0;
	if (_hasTrigger && _priceRaw * 1 > 0) {
		// limit (1) or stop (2)?
		const currentPrice = get(prices)[market];
		console.log('currentPrice', currentPrice);
		console.log('_price', _priceRaw);
		console.log('_isLong', _isLong);
		if (_isLong && _priceRaw * 1 <= currentPrice * 1 || !_isLong && _priceRaw * 1 >= currentPrice * 1) {
			orderType = 1;
		} else if (_isLong && _priceRaw * 1 >= currentPrice * 1|| !_isLong && _priceRaw * 1 <= currentPrice * 1) {
			orderType = 2;
		}
	}

	let value = '';
	if (_asset == 'ETH') {
		// Send value equal to margin + fee
		const feeAmount = _size.mul(marketInfo.fee).div(BPS_DIVIDER);
		console.log('marketInfo.fee', marketInfo.fee);
		console.log('feeAmount', feeAmount.toString());

		value = _margin.add(feeAmount);
		if (get(tpPrice)) {
			value = value.add(feeAmount);
		}
		if (get(slPrice)) {
			value = value.add(feeAmount);
		}
	}

	try {

		let tx, receipt;

		const orderTuple = createOrderTuple({
			market,
			asset,
			isLong: _isLong,
			margin: _margin,
			size: _size,
			price: _price,
			orderType,
			isReduceOnly: _isReduceOnly
		});

		console.log('orderTuple', orderTuple, get(tpPrice), get(slPrice), value);

		tx = await contract.submitOrder(orderTuple, parseUnits(get(tpPrice)), parseUnits(get(slPrice)), {value: value});

		receipt = await tx.wait();

		if (receipt && receipt.status == 1) {
			orderSubmitted();
			// getUserOrders();
			return true;
		}

	} catch(e) {
		showError(e);
	}

	submittingOrder.set(false);

}

// Used as a shorthand in close position modal
export async function submitCloseOrder(params) {

	const contract = await getContract('Orders', true);

	// Params
	const market = params.market;

	const _asset = getLabelForAsset(params.asset);
	const assetDecimals = CURRENCY_DECIMALS[_asset];

	const asset = params.asset;
	const isLong = params.isLong;
	const margin = 0;
	const size = parseUnits((params.size * 1).toFixed(6), assetDecimals);
	let price = 0;
	const orderType = 0;
	const isReduceOnly = true;

	let value = '';

	try {

		if (_asset == 'ETH') {
			// Send value equal to margin + fee
			let marketInfo = get(marketInfos)[market];
			console.log('marketInfo', marketInfo);

			const feeAmount = size.mul(marketInfo.fee).div(BPS_DIVIDER);
			value = feeAmount;
		}

		console.log('value', asset, value);

		let tx = await contract.submitOrder(
			createOrderTuple({
				market,
				asset,
				isLong,
				margin,
				size,
				price,
				orderType,
				isReduceOnly,
			}),
			0,
			0,
			{value: value}
		);

		let receipt = await tx.wait();

		if (receipt && receipt.status == 1) {
			// closeOrderSubmitted();
			// getUserOrders();
			return true;
		}

		return false;

	} catch(e) {
		showError(e);
	}

}

export async function cancelMultipleOrders(orderIds) {

	const contract = await getContract('Orders', true);

	try {

		let tx = await contract.cancelOrders(orderIds);

		let receipt = await tx.wait();

		if (receipt && receipt.status == 1) {
			showToast('Orders cancelled.', 1);
			// getUserOrders();
			return true;
		}

		return false;

	} catch(e) {
		showError(e);
	}

}

export async function selfExecuteOrder(orderId) {

	const contract = await getContract('Processor', true);

	try {

		let tx = await contract.selfExecuteOrder(orderId);

		let receipt = await tx.wait();

		if (receipt && receipt.status == 1) {
			showToast('Order self-executed.', 1);
			// getUserOrders();
			return true;
		}

		return false;

	} catch(e) {
		showError(e);
	}

}