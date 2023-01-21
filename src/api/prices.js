import { get } from 'svelte/store'
import { onNewPrice } from '@lib/chart'
import { formatForDisplay } from '@lib/formatters'
import { prices, priceTimestamps, selectedMarket, marketInfos, ohlc, CAPPrice, positions } from '@lib/stores'
import { setPageTitle } from '@lib/ui'
import { getChainData } from '@lib/utils'

export async function getMarketTickers(type) {

	const dataEndpoint = getChainData('dataEndpoint');
	try {
		const response = await fetch(`${dataEndpoint}/ticker/all?type=${type}`);
		const json = await response.json();

		// console.log('type', type);
		// console.log('json', json);
		// json: {market => {o,h,l,c,t}}

		if (type == 'latest') {
			for (const m in json) {

				// const lastPriceTimestamp = get(priceTimestamps)[m];
				// if (lastPriceTimestamp && lastPriceTimestamp * 1 >= json[m] * 1) {
				// 	// sent timestamp is older than one we have, dont update
				// 	continue;
				// }

				prices.update((p) => {
					p[m] = json[m]['c'];
					return p;
				});
				priceTimestamps.update((p) => {
					p[m] = json[m]['t'];
					return p;
				});
			}
		} else {
			for (const m in json) {
				ohlc.update((x) => {
					x[m] = json[m];
					return x;
				});
			}
		}
		return json;
	} catch(e) {
		console.error('/ticker GET error', market, e);
	}
}

export async function getMarketCandles(params) {
	const dataEndpoint = getChainData('dataEndpoint');
	try {
		const response = await fetch(`${dataEndpoint}/candles/${params.market}?resolution=${params.resolution}&end=${params.end}`);
		const json = await response.json();
		return json;
	} catch(e) {
		console.error('/candles GET error', params, e);
	}
}

export async function getCAPPrice() {
	try {
		const response = await fetch('https://api.thegraph.com/subgraphs/name/ianlapham/arbitrum-dev', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				query: `
					query {
						token(id: "${getChainData('cap').toLowerCase()}") {
							tokenDayData(first: 1, orderBy: date, orderDirection: desc) {
								close
							}
						}
					}`
			})
		});
		const json = await response.json();
		const price = json?.data?.token?.tokenDayData?.[0]?.close || 100;
		CAPPrice.set(price);
	} catch (e) {
		console.error('/getCAPPrice', e);
	}
}