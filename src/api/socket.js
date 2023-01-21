import { get } from 'svelte/store'
import { PriceServiceConnection } from "@pythnetwork/pyth-common-js";
import { Buffer } from "buffer";
import { prices, marketInfos } from '@lib/stores'

export class EvmPriceServiceConnection extends PriceServiceConnection {
  /**
   * Gets price update data which then can be submitted to Pyth contract to update the prices.
   * This will throw an axios error if there is a network problem or the price service returns a non-ok response (e.g: Invalid price ids)
   *
   * @param priceIds Array of hex-encoded price ids.
   * @returns Array of price update data.
   */
  async getPriceFeedsUpdateData(priceIds) {
    const latestVaas = await this.getLatestVaas(priceIds);
    return latestVaas.map(
      (vaa) => "0x" + Buffer.from(vaa, "base64").toString("hex")
    );
  }
}

let connection, t;

export function connectSocket() {

	clearTimeout(t);

	if (connection) {
		connection.closeWebSocket();
	}

	const _marketInfos = get(marketInfos);

	if (!_marketInfos || !_marketInfos['BTC-USD']) {
		// Markets not ready yet, retry
		t = setTimeout(connectSocket, 2 * 1000);
		return;
	}

	connection = new EvmPriceServiceConnection("https://xc-testnet.pyth.network");

	// map market => feedId and feedId => market
	let priceIds = [];
	let pythFeedToMarket = {};
	for (const market in _marketInfos) {
		const marketInfo = _marketInfos[market];
		priceIds.push(marketInfo.pythFeed);
		pythFeedToMarket[marketInfo.pythFeed] = market;
	}

	// TEST
	priceIds = [
	  // You can find the ids of prices at https://pyth.network/developers/price-feed-ids#pyth-evm-testnet
	  "f9c0172ba10dfa4d19088d94f5bf61d3b54d5bd7483a322a982e1373ee8ea31b", // BTC/USD price id in testnet
	  "ca80ba6dc32e08d06f1aa886011eed1d77c77be9eb761cc10d72b7d0a2fd57a6", // ETH/USD price id in testnet
	];
	pythFeedToMarket = {
		'f9c0172ba10dfa4d19088d94f5bf61d3b54d5bd7483a322a982e1373ee8ea31b': 'BTC-USD',
		'ca80ba6dc32e08d06f1aa886011eed1d77c77be9eb761cc10d72b7d0a2fd57a6': 'ETH-USD'
	};

	connection.subscribePriceFeedUpdates(priceIds, (priceFeed) => {
		const market = pythFeedToMarket[priceFeed.id];
		// console.log(`Received update for ${priceFeed.id} (${market})`);
		const priceObj = priceFeed.getPriceNoOlderThan(60);
		if (priceObj) {

			try {
				// convert price to decimal without exponent and extra 0s
				const price = priceObj.price / 10**(-1 * priceObj.expo);
				// console.log(market, price);
				prices.update((p) => {
					p[market] = price;
					return p;
				});
			} catch(e) {
				console.error(e);
			}

		} // else price is stale
	});

}

export function closeSocket() {
	if (connection) {
		connection.closeWebSocket();
	}
}