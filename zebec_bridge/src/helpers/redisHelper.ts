import { Mutex } from 'async-mutex';
import { createClient } from 'redis';

import {
  ChainId,
  uint8ArrayToHex,
} from '@certusone/wormhole-sdk';
import {
  ParsedVaa,
  ParsedZebecPayload,
} from '@zebec-io/zebec-wormhole-sdk';

import { getCommonEnvironment } from '../configureEnv';
import { chainIDStrings } from '../utils/wormhole';
import { getScopedLogger } from './logHelper';
import { PromHelper } from './promHelpers';
import { sleep } from './utils';

const logger = getScopedLogger(["redisHelper"]);
const commonEnv = getCommonEnvironment();
const { redisHost, redisPort } = commonEnv;
let promHelper: PromHelper;

//Module internals
const redisMutex = new Mutex();
let redisQueue = new Array<[string, string]>();

export function getBackupQueue() {
	return redisQueue;
}

export enum RedisTables {
	INCOMING = 0,
	WORKING = 1,
}

export function init(ph: PromHelper): boolean {
	logger.info("will connect to redis at [" + redisHost + ":" + redisPort + "]");
	promHelper = ph;
	return true;
}

export async function connectToRedis() {
	let rClient;
	try {
		rClient = createClient({
			socket: {
				host: redisHost,
				port: redisPort,
			},
		});

		rClient.on("connect", function (err) {
			if (err) {
				logger.error(
					"connectToRedis: failed to connect to host [" + redisHost + "], port [" + redisPort + "]: %o",
					err,
				);
			}
		});

		await rClient.connect();
	} catch (e) {
		logger.error("connectToRedis: failed to connect to host [" + redisHost + "], port [" + redisPort + "]: %o", e);
	}

	return rClient;
}

export async function storeInRedis(name: string, value: string) {
	if (!name) {
		logger.error("storeInRedis: missing name");
		return;
	}
	if (!value) {
		logger.error("storeInRedis: missing value");
		return;
	}

	await redisMutex.runExclusive(async () => {
		logger.debug("storeInRedis: connecting to redis.");
		let redisClient;
		try {
			redisQueue.push([name, value]);
			redisClient = await connectToRedis();
			if (!redisClient) {
				logger.error(
					"Failed to connect to redis, enqueued vaa, there are now " + redisQueue.length + " enqueued events",
				);
				return;
			}

			logger.debug("now connected to redis, attempting to push " + redisQueue.length + " queued items");
			for (let item = redisQueue.pop(); item; item = redisQueue.pop()) {
				await addToRedis(redisClient, item[0], item[1]);
			}
		} catch (e) {
			logger.error("Failed during redis item push. Currently" + redisQueue.length + " enqueued items");
			logger.error("encountered an exception while pushing items to redis %o", e);
		}

		try {
			if (redisClient) {
				await redisClient.quit();
			}
		} catch (e) {
			logger.error("Failed to quit redis client");
		}
	});

	promHelper.handleListenerMemqueue(redisQueue.length);
}

export async function addToRedis(redisClient: any, name: string, value: string) {
	try {
		logger.debug("storeInRedis: storing in redis. name: " + name);
		await redisClient.select(RedisTables.INCOMING);
		await redisClient.set(name, value);

		logger.debug("storeInRedis: finished storing in redis.");
	} catch (e) {
		logger.error("storeInRedis: failed to store to host [" + redisHost + "], port [" + redisPort + "]: %o", e);
	}
}

export enum Status {
	Pending = 1,
	Completed = 2,
	Error = 3,
	FatalError = 4,
}

export type RelayResult = {
	status: Status;
	result: string | null;
};

export type WorkerInfo = {
	index: number;
	walletPrivateKey: Uint8Array;
};

export type StoreKey = {
	chain_id: number;
	emitter_address: string;
	sequence: number;
};

export type StorePayload = {
	vaa_bytes: string;
	status: Status;
	timestamp: string;
	retries: number;
};

/** Default redis payload */
export function initPayload(): StorePayload {
	return {
		vaa_bytes: "",
		status: Status.Pending,
		timestamp: new Date().toISOString(),
		retries: 0,
	};
}

export function initPayloadWithVAA(vaa_bytes: string): StorePayload {
	const sp: StorePayload = initPayload();
	sp.vaa_bytes = vaa_bytes;
	return sp;
}

export function storeKeyFromParsedVAA(parsedVAA: ParsedVaa<ParsedZebecPayload>): StoreKey {
	return {
		chain_id: parsedVAA.emitterChain as number,
		emitter_address: uint8ArrayToHex(parsedVAA.emitterAddress),
		sequence: parsedVAA.sequence,
	};
}

/** Stringify the key going into redis as json */
export function storeKeyToJson(storeKey: StoreKey): string {
	return JSON.stringify(storeKey);
}

export function storeKeyFromJson(json: string): StoreKey {
	return JSON.parse(json);
}

/** Stringify the value going into redis as json */
export function storePayloadToJson(storePayload: StorePayload): string {
	return JSON.stringify(storePayload);
}

export function storePayloadFromJson(json: string): StorePayload {
	return JSON.parse(json);
}

export function resetPayload(storePayload: StorePayload): StorePayload {
	return initPayloadWithVAA(storePayload.vaa_bytes);
}

export async function clearRedis() {
	const redisClient = await connectToRedis();
	if (!redisClient) {
		logger.error("Failed to connect to redis to clear tables.");
		return;
	}
	await redisClient.FLUSHALL();
	redisClient.quit();
}

export async function demoteWorkingRedis() {
	const redisClient = await connectToRedis();
	if (!redisClient) {
		logger.error("Failed to connect to redis to clear tables.");
		return;
	}
	await redisClient.select(RedisTables.WORKING);
	for await (const si_key of redisClient.scanIterator()) {
		const si_value = await redisClient.get(si_key);
		if (!si_value) {
			continue;
		}
		logger.info("Demoting %s", si_key);
		await redisClient.del(si_key);
		await redisClient.select(RedisTables.INCOMING);
		await redisClient.set(si_key, storePayloadToJson(resetPayload(storePayloadFromJson(si_value))));
		await redisClient.select(RedisTables.WORKING);
	}
	redisClient.quit();
}

type SourceMap = {
	[key in ChainId]: number;
};

export function createSourceMap(knownChainIds: ChainId[]): SourceMap {
	const sourceMap: SourceMap = {} as SourceMap;
	for (const sourceKey of knownChainIds) {
		sourceMap[sourceKey] = 0;
	}
	return sourceMap;
}

export async function incrementSourceMap(key: string, sourceMap: SourceMap): Promise<void> {
	const parsedKey = storeKeyFromJson(key);
	if (sourceMap[parsedKey.chain_id as ChainId] !== undefined) {
		sourceMap[parsedKey.chain_id as ChainId]++;
	}
}

export async function monitorRedis(metrics: PromHelper) {
	const scopedLogger = getScopedLogger(["monitorRedis"], logger);
	const TEN_SECONDS: number = 10000;
	const knownChainIds = Object.keys(chainIDStrings).map((c) => Number(c) as ChainId);
	while (true) {
		const redisClient = await connectToRedis();
		if (!redisClient) {
			scopedLogger.error("Failed to connect to redis!");
		} else {
			try {
				await redisClient.select(RedisTables.INCOMING);
				const incomingSourceMap = createSourceMap(knownChainIds);
				for await (const si_key of redisClient.scanIterator()) {
					incrementSourceMap(si_key, incomingSourceMap);
				}
				for (const sourceKey of knownChainIds) {
					metrics.setRedisQueue(RedisTables.INCOMING, sourceKey, incomingSourceMap[sourceKey]);
				}
				await redisClient.select(RedisTables.WORKING);
				const workingSourceMap = createSourceMap(knownChainIds);
				for await (const si_key of redisClient.scanIterator()) {
					incrementSourceMap(si_key, workingSourceMap);
				}
				for (const sourceKey of knownChainIds) {
					metrics.setRedisQueue(RedisTables.WORKING, sourceKey, workingSourceMap[sourceKey]);
				}
			} catch (e) {
				scopedLogger.error("Failed to get dbSize and set metrics!");
			}
			try {
				redisClient.quit();
			} catch (e) {}
		}
		await sleep(TEN_SECONDS);
	}
}

/** Check to see if a key is in the listener memory queue or redis incoming db */
export async function checkQueue(key: string): Promise<string | null> {
	try {
		const backupQueue = getBackupQueue();
		const queuedRecord = backupQueue.find((record) => record[0] === key);

		if (queuedRecord) {
			logger.debug("VAA was already in the listener queue");
			return "VAA was already in the listener queue";
		}

		const rClient = await connectToRedis();
		if (!rClient) {
			logger.error("Failed to connect to redis");
			return null;
		}

		await rClient.select(RedisTables.INCOMING);
		const record1 = await rClient.get(key);

		if (record1) {
			logger.debug("VAA was already in INCOMING table");
			rClient.quit();
			return "VAA was already in INCOMING table";
		}

		await rClient.select(RedisTables.WORKING);
		const record2 = await rClient.get(key);
		if (record2) {
			logger.debug("VAA was already in WORKING table");
			rClient.quit();
			return "VAA was already in WORKING table";
		}
		rClient.quit();
	} catch (e) {
		logger.error("Failed to connect to redis");
	}

	return null;
}
