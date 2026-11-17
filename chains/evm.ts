// Compiles chains/PhilRiscV.sol and runs it in a local Ethereum VM (the reference EVM written in
// JavaScript). Tests and the workflow use this to prove the contract before anything is deployed.
import * as fs from "fs";
import { VM } from "@ethereumjs/vm";
import { Common, Chain, Hardfork } from "@ethereumjs/common";
import { LegacyTransaction } from "@ethereumjs/tx";
import { Address, Account, hexToBytes, bytesToHex } from "@ethereumjs/util";
import { Interface } from "ethers";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const solc = require("solc");

export interface Compiled { abi: any[]; bytecode: string; solc: string }
export function compile(file = "chains/PhilRiscV.sol"): Compiled {
  const input = { language: "Solidity", sources: { "PhilRiscV.sol": { content: fs.readFileSync(file, "utf8") } },
    settings: { optimizer: { enabled: true, runs: 1000000 }, viaIR: true, evmVersion: "paris", outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } } };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (out.errors ?? []).filter((e: any) => e.severity === "error");
  if (errors.length) throw new Error(errors.map((e: any) => e.formattedMessage).join("\n"));
  const c = out.contracts["PhilRiscV.sol"].PhilRiscV;
  return { abi: c.abi, bytecode: "0x" + c.evm.bytecode.object, solc: solc.version() };
}

const KEY = hexToBytes("0x" + "11".repeat(32));
export class LocalChain {
  readonly sender = Address.fromPrivateKey(KEY);
  private constructor(readonly vm: VM, readonly common: Common) {}
  static async start(): Promise<LocalChain> {
    const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Shanghai });
    const vm = await VM.create({ common });
    const c = new LocalChain(vm, common);
    await vm.stateManager.putAccount(c.sender, Account.fromAccountData({ balance: 10n ** 22n }));
    return c;
  }
  /** Sends a real transaction through the VM. */
  async send(to: string | null, data: string, gasLimit = 29_000_000n) {
    const nonce = (await this.vm.stateManager.getAccount(this.sender))?.nonce ?? 0n;
    const tx = LegacyTransaction.fromTxData({ nonce, gasPrice: 10n ** 9n, gasLimit, to: (to ?? undefined) as any, data: data as any }, { common: this.common }).sign(KEY);
    const r = await this.vm.runTx({ tx, skipBlockGasLimitValidation: true });
    return { ok: !r.execResult.exceptionError, gas: r.totalGasSpent, created: r.createdAddress?.toString() ?? null, returned: bytesToHex(r.execResult.returnValue), logs: r.execResult.logs ?? [] };
  }
  /** A read-only call, like eth_call. */
  async call(to: string, data: string, gasLimit = 29_000_000n) {
    const r = await this.vm.evm.runCall({ to: Address.fromString(to), caller: Address.fromString('0x' + '22'.repeat(20)), data: hexToBytes(data), gasLimit, isStatic: true });
    return { ok: !r.execResult.exceptionError, gas: r.execResult.executionGasUsed, returned: bytesToHex(r.execResult.returnValue) };
  }
  async codeSize(a: string) { return (await this.vm.stateManager.getContractCode(Address.fromString(a))).length; }
}
export const iface = (c: Compiled) => new Interface(c.abi);
