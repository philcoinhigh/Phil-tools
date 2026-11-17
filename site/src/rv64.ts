// A small RISC-V (rv64im) machine, enough to run the image built from Phil's emitted upload server
// and chains/runtime.c. It is the reference for chains/PhilRiscV.sol, the interpreter contract that
// runs the same image on EVM chains: the two must agree on every upload, and test/chains.ts checks
// that they do. The page uses it to run the image in the browser.
//
// Memory map, shared with the contract: 128 KiB. The image is loaded at 0x1000, the upload is put
// at 0x18000, and the stack grows down from the top. The host answers three requests ("ecall",
// number in a7): 0 end with a0 as the result, 1 log(a0, a1), 2 sha256(a0, a1) into a2.
import { sha256 } from "./draw";

export const MEMORY = 0x20000, LOAD_AT = 0x1000, INPUT_AT = 0x18000, MAX_INPUT = 0x2000;
export interface Run { code: number; logs: string[]; steps: number }
const M64 = (1n << 64n) - 1n;
const s64 = (v: bigint) => BigInt.asIntN(64, v), u64 = (v: bigint) => BigInt.asUintN(64, v), s32 = (v: bigint) => u64(BigInt.asIntN(32, v));

export function runImage(image: Uint8Array, input: Uint8Array, maxSteps = 2_000_000): Run {
  if (LOAD_AT + image.length > INPUT_AT) throw new Error("The image does not fit.");
  if (input.length > MAX_INPUT) throw new Error("The upload is too long for this machine.");
  const mem = new Uint8Array(MEMORY), x: bigint[] = new Array(32).fill(0n), logs: string[] = [];
  mem.set(image, LOAD_AT); mem.set(input, INPUT_AT);
  x[2] = BigInt(MEMORY); x[10] = BigInt(INPUT_AT); x[11] = BigInt(input.length);
  let pc = LOAD_AT;
  const at = (a: bigint, w: number) => { const n = Number(a); if (a < 0n || n + w > MEMORY) throw new Error(`The program reached outside its memory (at 0x${a.toString(16)}).`); return n; };
  const load = (a: bigint, w: number) => { const n = at(a, w); let v = 0n; for (let i = w - 1; i >= 0; i--) v = (v << 8n) | BigInt(mem[n + i]); return v; };
  const store = (a: bigint, w: number, v: bigint) => { const n = at(a, w); for (let i = 0; i < w; i++) { mem[n + i] = Number(v & 0xffn); v >>= 8n; } };
  for (let steps = 1; steps <= maxSteps; steps++) {
    if (pc < 0 || pc + 4 > MEMORY) throw new Error("The program jumped outside its memory.");
    const inst = (mem[pc] | (mem[pc + 1] << 8) | (mem[pc + 2] << 16) | (mem[pc + 3] << 24)) >>> 0;
    const op = inst & 0x7f, rd = (inst >>> 7) & 31, f3 = (inst >>> 12) & 7, rs1 = (inst >>> 15) & 31, rs2 = (inst >>> 20) & 31, f7 = inst >>> 25;
    const a = x[rs1], b = x[rs2], immI = BigInt((inst | 0) >> 20), immS = BigInt((((inst | 0) >> 25) << 5) | ((inst >>> 7) & 31));
    let next = pc + 4, out: bigint | null = null;
    const bad = () => new Error(`The program used an instruction this machine does not have (0x${inst.toString(16)} at 0x${pc.toString(16)}).`);
    switch (op) {
      case 0x37: out = u64(BigInt((inst & 0xfffff000) | 0)); break;                                    // lui
      case 0x17: out = u64(BigInt(pc) + BigInt((inst & 0xfffff000) | 0)); break;                        // auipc
      case 0x6f: { const imm = (((inst | 0) >> 31) << 20) | (inst & 0xff000) | (((inst >>> 20) & 1) << 11) | (((inst >>> 21) & 0x3ff) << 1); out = BigInt(next); next = pc + imm; break; }   // jal
      case 0x67: { if (f3 !== 0) throw bad(); out = BigInt(next); next = Number(u64(a + immI) & ~1n); break; }                              // jalr
      case 0x63: {
        const imm = (((inst | 0) >> 31) << 12) | (((inst >>> 25) & 0x3f) << 5) | (((inst >>> 8) & 0xf) << 1) | (((inst >>> 7) & 1) << 11);
        const take = f3 === 0 ? a === b : f3 === 1 ? a !== b : f3 === 4 ? s64(a) < s64(b) : f3 === 5 ? s64(a) >= s64(b) : f3 === 6 ? a < b : f3 === 7 ? a >= b : null;
        if (take === null) throw bad();
        if (take) next = pc + imm; break;
      }
      case 0x03: {
        const addr = u64(a + immI);
        out = f3 === 0 ? u64(BigInt.asIntN(8, load(addr, 1))) : f3 === 1 ? u64(BigInt.asIntN(16, load(addr, 2))) : f3 === 2 ? s32(load(addr, 4)) : f3 === 3 ? load(addr, 8) : f3 === 4 ? load(addr, 1) : f3 === 5 ? load(addr, 2) : f3 === 6 ? load(addr, 4) : null;
        if (out === null) throw bad(); break;
      }
      case 0x23: { if (f3 > 3) throw bad(); store(u64(a + immS), 1 << f3, b); break; }
      case 0x13: {
        const sh = BigInt((inst >>> 20) & 63), top = inst >>> 26;
        out = f3 === 0 ? u64(a + immI) : f3 === 2 ? (s64(a) < immI ? 1n : 0n) : f3 === 3 ? (a < u64(immI) ? 1n : 0n) : f3 === 4 ? a ^ u64(immI) : f3 === 6 ? a | u64(immI) : f3 === 7 ? a & u64(immI)
          : f3 === 1 && top === 0 ? u64(a << sh) : f3 === 5 && top === 0 ? a >> sh : f3 === 5 && top === 0x10 ? u64(s64(a) >> sh) : null;
        if (out === null) throw bad(); break;
      }
      case 0x1b: {
        const sh = BigInt(rs2);
        out = f3 === 0 ? s32(a + immI) : f3 === 1 && f7 === 0 ? s32(a << sh) : f3 === 5 && f7 === 0 ? s32((a & 0xffffffffn) >> sh) : f3 === 5 && f7 === 0x20 ? s32(BigInt.asIntN(32, a) >> sh) : null;
        if (out === null) throw bad(); break;
      }
      case 0x33: {
        const sh = b & 63n, sa = s64(a), sb = s64(b);
        if (f7 === 1) out = f3 === 0 ? u64(a * b) : f3 === 1 ? u64((sa * sb) >> 64n) : f3 === 2 ? u64((sa * b) >> 64n) : f3 === 3 ? (a * b) >> 64n
          : f3 === 4 ? (b === 0n ? M64 : u64(sa / sb)) : f3 === 5 ? (b === 0n ? M64 : a / b) : f3 === 6 ? (b === 0n ? a : u64(sa % sb)) : (b === 0n ? a : a % b);
        else out = f3 === 0 && f7 === 0 ? u64(a + b) : f3 === 0 && f7 === 0x20 ? u64(a - b) : f3 === 1 && f7 === 0 ? u64(a << sh) : f3 === 2 && f7 === 0 ? (sa < sb ? 1n : 0n) : f3 === 3 && f7 === 0 ? (a < b ? 1n : 0n)
          : f3 === 4 && f7 === 0 ? a ^ b : f3 === 5 && f7 === 0 ? a >> sh : f3 === 5 && f7 === 0x20 ? u64(sa >> sh) : f3 === 6 && f7 === 0 ? a | b : f3 === 7 && f7 === 0 ? a & b : null;
        if (out === null) throw bad(); break;
      }
      case 0x3b: {
        const sh = b & 31n, wa = BigInt.asIntN(32, a), wb = BigInt.asIntN(32, b), ua = a & 0xffffffffn, ub = b & 0xffffffffn;
        if (f7 === 1) out = f3 === 0 ? s32(a * b) : f3 === 4 ? (ub === 0n ? M64 : s32(wa / wb)) : f3 === 5 ? (ub === 0n ? M64 : s32(ua / ub)) : f3 === 6 ? (ub === 0n ? s32(a) : s32(wa % wb)) : f3 === 7 ? (ub === 0n ? s32(a) : s32(ua % ub)) : null;
        else out = f3 === 0 && f7 === 0 ? s32(a + b) : f3 === 0 && f7 === 0x20 ? s32(a - b) : f3 === 1 && f7 === 0 ? s32(a << sh) : f3 === 5 && f7 === 0 ? s32(ua >> sh) : f3 === 5 && f7 === 0x20 ? s32(wa >> sh) : null;
        if (out === null) throw bad(); break;
      }
      case 0x73: {
        if (inst !== 0x73) throw bad();
        const call = x[17];
        if (call === 0n) return { code: Number(x[10]), logs, steps };
        else if (call === 1n) { const n = at(x[10], Number(x[11])); logs.push(new TextDecoder().decode(mem.slice(n, n + Number(x[11])))); }
        else if (call === 2n) { const n = at(x[10], Number(x[11])); mem.set(sha256(mem.slice(n, n + Number(x[11]))), at(x[12], 32)); }
        else throw new Error("The program asked the host for something it does not offer.");
        break;
      }
      default: throw bad();
    }
    if (out !== null && rd !== 0) x[rd] = out;
    pc = next;
  }
  throw new Error("The program did not finish.");
}
