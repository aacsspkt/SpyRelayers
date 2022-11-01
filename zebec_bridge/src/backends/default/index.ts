import { Backend } from '../definitions';
import { ZebecBridgeLister } from './listener';
import { ZebecBridgeRelayer } from './relayer';

/** Payload version 1 token bridge listener and relayer backend */
const backend: Backend = {
	relayer: new ZebecBridgeRelayer(),
	listener: new ZebecBridgeLister(),
};

export default backend;
