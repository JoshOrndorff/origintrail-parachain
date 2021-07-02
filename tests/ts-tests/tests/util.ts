import Web3 from "web3";
import { JsonRpcResponse } from "web3-core-helpers";
import { spawn, ChildProcess } from "child_process";

export const PORT = 19931;
export const RPC_PORT = 19932;
export const WS_PORT = 19933;
export const SPECS_PATH = `./otparachain-test-specs`;

export const DISPLAY_LOG = process.env.FRONTIER_LOG || false;
export const OTParachain_LOG = process.env.FRONTIER_LOG || "info";

export const BINARY_PATH = `../../target/release/origintrail-parachain`;
export const SPAWNING_TIME = 30000;

export async function customRequest(web3: Web3, method: string, params: any[]) {
	return new Promise<JsonRpcResponse>((resolve, reject) => {
		(web3.currentProvider as any).send(
			{
				jsonrpc: "2.0",
				id: 1,
				method,
				params,
			},
			(error: Error | null, result?: JsonRpcResponse) => {
				if (error) {
					reject(
						`Failed to send custom request (${method} (${params.join(",")})): ${
							error.message || error.toString()
						}`
					);
				}
				resolve(result);
			}
		);
	});
}

// Create a block and finalize it.
// It will include all previously executed transactions since the last finalized block.
export async function createAndFinalizeBlock(web3: Web3) {
	const response = await customRequest(web3, "engine_createBlock", [true, true, null]);
	if (!response.result) {
		throw new Error(`Unexpected result: ${JSON.stringify(response)}`);
	}
}

let nodeStarted = false;

export async function startOTParachainNode(specFilename: string, provider?: string): Promise<{ web3: Web3; binary: ChildProcess }> {

	while (nodeStarted) {
		// Wait 100ms to see if the node is free
		await new Promise((resolve) => {
			setTimeout(resolve, 100);
		});
	}
	nodeStarted = true;

	var web3;
	if (!provider || provider == 'http') {
		web3 = new Web3(`http://localhost:${RPC_PORT}`);
	}

	const cmd = BINARY_PATH;
	const args = [
		`--execution=Native`, // Faster execution using native
		`--no-telemetry`,
		`--no-prometheus`,
		`--dev`,
		`--sealing=manual`,
		`-l${OTParachain_LOG}`,
		`--port=${PORT}`,
		`--rpc-port=${RPC_PORT}`,
		`--ws-port=${WS_PORT}`,
		`--tmp`,
	];


	const onProcessExit = function() {
		binary && binary.kill();
	}

	const onProcessInterrupt = function() {
		process.exit(2);
	}

	let binary: ChildProcess = null;
	process.once("exit", onProcessExit);
	process.once("SIGINT", onProcessInterrupt);
	binary = spawn(cmd, args);

	binary.once("exit", () => {
		process.removeListener("exit", onProcessExit);
		process.removeListener("SIGINT", onProcessInterrupt);
		nodeStarted = false;
	});

	binary.on("error", (err) => {
		if ((err as any).errno == "ENOENT") {
			console.error(
				`\x1b[31mMissing OriginTrail Parachain binary (${BINARY_PATH}).\nPlease compile the OriginTrail Parachain project:\ncargo build\x1b[0m`
			);
		} else {
			console.error(err);
		}
		process.exit(1);
	});

	const binaryLogs = [];
	await new Promise((resolve) => {
		const timer = setTimeout(() => {
			console.error(`\x1b[31m Failed to start OriginTrail Parachain Node.\x1b[0m`);
			console.error(`Command: ${cmd} ${args.join(" ")}`);
			console.error(`Logs:`);
			console.error(binaryLogs.map((chunk) => chunk.toString()).join("\n"));
			throw new Error("Failed to launch node");
		}, SPAWNING_TIME - 2000);

		const onData = async (chunk) => {
			if (DISPLAY_LOG) {
				console.log(chunk.toString());
			}
			binaryLogs.push(chunk);
			if (chunk.toString().match(/Development Service Ready/)) {
				/*if (!provider || provider == "http") {
					// This is needed as the EVM runtime needs to warmup with a first call
					await web3.eth.getChainId();
				}*/

				clearTimeout(timer);
				if (!DISPLAY_LOG) {
					binary.stderr.off("data", onData);
					binary.stdout.off("data", onData);
				}
				// console.log(`\x1b[31m Starting RPC\x1b[0m`);
				resolve();
			}
		};
		binary.stderr.on("data", onData);
		binary.stdout.on("data", onData);
	});

	if (provider == 'ws') {
		web3 = new Web3(`ws://localhost:${WS_PORT}`);
	}

	return { web3, binary };
}

export function describeWithOTParachain(title: string, specFilename: string, cb: (context: { web3: Web3 }) => void, provider?: string) {
	describe(title, () => {
		let context: { web3: Web3 } = { web3: null };
		let binary: ChildProcess;
		// Making sure the OriginTrail Parachain node has started
		before("Starting OTParachain", async function () {
			this.timeout(SPAWNING_TIME);
			const init = await startOTParachainNode(specFilename, provider);
			context.web3 = init.web3;
			binary = init.binary;
		});

		after(async function () {
			//console.log(`\x1b[31m Killing RPC\x1b[0m`);
			binary.kill();
		});

		cb(context);
	});
}
