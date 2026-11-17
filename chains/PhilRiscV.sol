// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Runs Phil's compiled upload server on any EVM chain.
///
/// Phil compiles to LLVM and has no EVM backend, so EVM chains cannot run its output directly.
/// This contract is a small RISC-V (rv64im) interpreter. The image it runs is built from the
/// same Phil-emitted module that runs natively on Solana (chains/build-riscv.sh), and every
/// instruction of it is executed here, on chain. Optimism's fault proofs run MIPS and RISC-V
/// inside the EVM the same way.
///
/// Memory map, shared with the reference machine in site/src/rv64.ts: 128 KiB. The image is
/// loaded at 0x1000, the upload is put at 0x18000, the stack grows down from the top. The host
/// answers three requests ("ecall", number in a7): 0 end with a0 as the result, 1 log(a0, a1),
/// 2 sha256(a0, a1) into a2, which is the EVM's own SHA-256 precompile.
///
/// The machine's memory is kept in EVM memory back to front: RISC-V byte `a` lives at EVM offset
/// TOP - a. RISC-V is little-endian and the EVM reads big-endian words, so a value of any width
/// at address `a` is then simply the low bytes of the EVM word that ends at TOP - a.
///
/// This interpreter is ours and is not Phil. It has not been audited.
contract PhilRiscV {
    /// A contract whose code is one zero byte, then the image back to front.
    address public immutable image;
    uint256 public immutable imageLength;
    /// SHA-256 of the image as built, front to back: compare it with the published build.
    bytes32 public immutable imageSha256;
    /// How many uploads Phil's server has accepted through `submit`.
    uint256 public accepted;

    event Accepted(address indexed sender, bytes32 uploadSha256, uint256 number);
    error Refused(uint256 code);

    constructor(bytes memory img) {
        uint256 n = img.length;
        require(n > 0 && n <= 0x5f00, "image size");
        imageLength = n;
        imageSha256 = sha256(img);
        address made;
        assembly {
            // Creation code that returns: 00, then the image reversed.
            let p := mload(0x40)
            // PUSH2 length, DUP1, PUSH1 0c, PUSH1 00, CODECOPY, PUSH1 00, RETURN
            mstore8(p, 0x61) mstore8(add(p, 1), shr(8, add(n, 1))) mstore8(add(p, 2), and(add(n, 1), 0xff))
            mstore8(add(p, 3), 0x80) mstore8(add(p, 4), 0x60) mstore8(add(p, 5), 0x0c) mstore8(add(p, 6), 0x60) mstore8(add(p, 7), 0x00)
            mstore8(add(p, 8), 0x39) mstore8(add(p, 9), 0x60) mstore8(add(p, 10), 0x00) mstore8(add(p, 11), 0xf3)
            mstore8(add(p, 12), 0)
            for { let i := 0 } lt(i, n) { i := add(i, 1) } { mstore8(add(add(p, 13), i), byte(0, mload(add(add(img, 32), sub(sub(n, 1), i))))) }
            made := create(0, p, add(n, 13))
        }
        require(made != address(0), "image not stored");
        image = made;
    }

    /// Runs Phil's server over one upload and changes nothing. `code` 0 means ACCEPTED; anything
    /// else is 1000 + 100 x outcome + reason, the same numbers the Solana program returns.
    function run(bytes calldata upload) public view returns (uint256 code, uint256 steps, string memory logs) {
        address img = image;
        uint256 n = imageLength;
        assembly {
            // REG 0x80: 32 registers of 32 bytes. Machine memory: 0x4a0 .. 0x2049f, back to front.
            // W = 0x20480: the EVM word holding RISC-V bytes a .. (and above) starts at W - a.
            // SCRATCH 0x204e0 (for SHA-256). OUT 0x22500: code, steps, 0x60, log length, log bytes.
            function trap(at_pc, inst) { mstore(0, at_pc) mstore(32, inst) revert(0, 64) }
            function sx(v) -> r { r := signextend(7, v) }
            function w32(v) -> r { r := and(signextend(3, v), 0xffffffffffffffff) }
            function inside(a, w) { if gt(add(a, w), 0x20000) { trap(a, w) } }
            function op64(inst, a, b) -> out {
                let f3 := and(shr(12, inst), 7)
                let f7 := shr(25, inst)
                let M := 0xffffffffffffffff
                switch f7
                case 1 {
                    switch f3
                    case 0 { out := and(mul(a, b), M) }
                    case 1 { out := and(sar(64, mul(sx(a), sx(b))), M) }
                    case 2 { out := and(sar(64, mul(sx(a), b)), M) }
                    case 3 { out := shr(64, mul(a, b)) }
                    case 4 { out := M if b { out := and(sdiv(sx(a), sx(b)), M) } }
                    case 5 { out := M if b { out := div(a, b) } }
                    case 6 { out := a if b { out := and(smod(sx(a), sx(b)), M) } }
                    default { out := a if b { out := mod(a, b) } }
                }
                case 0 {
                    switch f3
                    case 0 { out := and(add(a, b), M) }
                    case 1 { out := and(shl(and(b, 63), a), M) }
                    case 2 { out := slt(sx(a), sx(b)) }
                    case 3 { out := lt(a, b) }
                    case 4 { out := xor(a, b) }
                    case 5 { out := shr(and(b, 63), a) }
                    case 6 { out := or(a, b) }
                    default { out := and(a, b) }
                }
                case 0x20 {
                    switch f3
                    case 0 { out := and(sub(a, b), M) }
                    case 5 { out := and(sar(and(b, 63), sx(a)), M) }
                    default { trap(0, inst) }
                }
                default { trap(0, inst) }
            }
            function op32(inst, a, b) -> out {
                let f3 := and(shr(12, inst), 7)
                let f7 := shr(25, inst)
                let ub := and(b, 0xffffffff)
                switch f7
                case 1 {
                    switch f3
                    case 0 { out := w32(mul(a, b)) }
                    case 4 { out := 0xffffffffffffffff if ub { out := w32(sdiv(signextend(3, a), signextend(3, b))) } }
                    case 5 { out := 0xffffffffffffffff if ub { out := w32(div(and(a, 0xffffffff), ub)) } }
                    case 6 { out := w32(a) if ub { out := w32(smod(signextend(3, a), signextend(3, b))) } }
                    case 7 { out := w32(a) if ub { out := w32(mod(and(a, 0xffffffff), ub)) } }
                    default { trap(0, inst) }
                }
                case 0 {
                    switch f3
                    case 0 { out := w32(add(a, b)) }
                    case 1 { out := w32(shl(and(b, 31), a)) }
                    case 5 { out := w32(shr(and(b, 31), and(a, 0xffffffff))) }
                    default { trap(0, inst) }
                }
                case 0x20 {
                    switch f3
                    case 0 { out := w32(sub(a, b)) }
                    case 5 { out := and(sar(and(b, 31), signextend(3, a)), 0xffffffffffffffff) }
                    default { trap(0, inst) }
                }
                default { trap(0, inst) }
            }
            function imm64(inst, a) -> out {
                let imm := sar(244, shl(224, inst))
                let M := 0xffffffffffffffff
                let sh := and(shr(20, inst), 63)
                switch and(shr(12, inst), 7)
                case 0 { out := and(add(a, imm), M) }
                case 1 { if shr(26, inst) { trap(0, inst) } out := and(shl(sh, a), M) }
                case 2 { out := slt(sx(a), imm) }
                case 3 { out := lt(a, and(imm, M)) }
                case 4 { out := xor(a, and(imm, M)) }
                case 5 {
                    switch shr(26, inst)
                    case 0 { out := shr(sh, a) }
                    case 0x10 { out := and(sar(sh, sx(a)), M) }
                    default { trap(0, inst) }
                }
                case 6 { out := or(a, and(imm, M)) }
                default { out := and(a, and(imm, M)) }
            }
            function imm32(inst, a) -> out {
                let sh := and(shr(20, inst), 31)
                switch and(shr(12, inst), 7)
                case 0 { out := w32(add(a, sar(244, shl(224, inst)))) }
                case 1 { if shr(25, inst) { trap(0, inst) } out := w32(shl(sh, a)) }
                case 5 {
                    switch shr(25, inst)
                    case 0 { out := w32(shr(sh, and(a, 0xffffffff))) }
                    case 0x20 { out := and(sar(sh, signextend(3, a)), 0xffffffffffffffff) }
                    default { trap(0, inst) }
                }
                default { trap(0, inst) }
            }
            function load(inst, a) -> out {
                let addr := and(add(a, sar(244, shl(224, inst))), 0xffffffffffffffff)
                let f3 := and(shr(12, inst), 7)
                let w := shl(and(f3, 3), 1)
                if eq(f3, 7) { trap(0, inst) }
                inside(addr, w)
                out := and(mload(sub(0x20480, addr)), sub(shl(shl(3, w), 1), 1))
                if lt(f3, 3) { out := and(signextend(sub(w, 1), out), 0xffffffffffffffff) }
            }
            function store(inst, a, b) {
                let imm := or(shl(5, sar(249, shl(224, inst))), and(shr(7, inst), 31))
                let addr := and(add(a, imm), 0xffffffffffffffff)
                let f3 := and(shr(12, inst), 7)
                if gt(f3, 3) { trap(0, inst) }
                inside(addr, shl(f3, 1))
                let m := sub(shl(shl(3, shl(f3, 1)), 1), 1)
                let p := sub(0x20480, addr)
                mstore(p, or(and(mload(p), not(m)), and(b, m)))
            }
            function branch(inst, a, b, at_pc) -> next {
                let t := 0
                switch and(shr(12, inst), 7)
                case 0 { t := eq(a, b) }
                case 1 { t := iszero(eq(a, b)) }
                case 4 { t := slt(sx(a), sx(b)) }
                case 5 { t := iszero(slt(sx(a), sx(b))) }
                case 6 { t := lt(a, b) }
                case 7 { t := iszero(lt(a, b)) }
                default { trap(at_pc, inst) }
                next := add(at_pc, 4)
                if t {
                    let imm := or(or(shl(12, sar(255, shl(224, inst))), shl(5, and(shr(25, inst), 0x3f))), or(shl(1, and(shr(8, inst), 0xf)), shl(11, and(shr(7, inst), 1))))
                    next := and(add(at_pc, imm), 0xffffffffffffffff)
                }
            }
            // The host. Returns 1 when the program has ended.
            function host() -> ended {
                let a0 := mload(0x1c0)                       // x10
                let a1 := mload(0x1e0)                       // x11
                switch mload(0x2a0)                          // x17
                case 0 { mstore(0x22500, a0) ended := 1 }
                case 1 {
                    inside(a0, a1)
                    let at := add(0x22580, mload(0x22560))
                    if gt(add(mload(0x22560), a1), 0x4000) { trap(a0, a1) }
                    for { let i := 0 } lt(i, a1) { i := add(i, 1) } { mstore8(add(at, i), mload(sub(0x20480, add(a0, i)))) }
                    mstore8(add(at, a1), 0x0a)
                    mstore(0x22560, add(add(mload(0x22560), a1), 1))
                }
                case 2 {
                    let o := mload(0x200)                    // x12
                    inside(a0, a1) inside(o, 32)
                    if gt(a1, 0x2000) { trap(a0, a1) }
                    for { let i := 0 } lt(i, a1) { i := add(i, 1) } { mstore8(add(0x204e0, i), mload(sub(0x20480, add(a0, i)))) }
                    if iszero(staticcall(gas(), 2, 0x204e0, a1, 0x204e0, 32)) { trap(a0, a1) }
                    let d := mload(0x204e0)
                    for { let i := 0 } lt(i, 32) { i := add(i, 1) } { mstore8(sub(0x2049f, add(o, i)), byte(i, d)) }
                }
                default { trap(0, mload(0x2a0)) }
            }

            if gt(upload.length, 0x2000) { trap(0, upload.length) }
            // Everything the machine uses starts at zero.
            calldatacopy(0x80, calldatasize(), sub(0x22580, 0x80))
            extcodecopy(img, sub(sub(0x2049f, 0x1000), sub(n, 1)), 1, n)
            for { let i := 0 } lt(i, upload.length) { i := add(i, 1) } { mstore8(sub(0x2049f, add(0x18000, i)), byte(0, calldataload(add(upload.offset, i)))) }
            mstore(0xc0, 0x20000)                            // x2, the stack pointer
            mstore(0x1c0, 0x18000)                           // x10 = a0: where the upload is
            mstore(0x1e0, upload.length)                     // x11 = a1: how long it is

            let at_pc := 0x1000
            let count := 0
            for { } 1 { } {
                count := add(count, 1)
                if gt(at_pc, 0x1fffc) { trap(at_pc, 0) }
                let inst := and(mload(sub(0x20480, at_pc)), 0xffffffff)
                let a := mload(add(0x80, shl(5, and(shr(15, inst), 31))))
                let b := mload(add(0x80, shl(5, and(shr(20, inst), 31))))
                let rd := add(0x80, shl(5, and(shr(7, inst), 31)))
                let next := add(at_pc, 4)
                switch and(inst, 0x7f)
                case 0x13 { mstore(rd, imm64(inst, a)) }
                case 0x33 { mstore(rd, op64(inst, a, b)) }
                case 0x03 { mstore(rd, load(inst, a)) }
                case 0x23 { store(inst, a, b) }
                case 0x63 { next := branch(inst, a, b, at_pc) }
                case 0x1b { mstore(rd, imm32(inst, a)) }
                case 0x3b { mstore(rd, op32(inst, a, b)) }
                case 0x6f {
                    mstore(rd, next)
                    next := and(add(at_pc, or(shl(20, sar(255, shl(224, inst))), or(and(inst, 0xff000), or(shl(11, and(shr(20, inst), 1)), shl(1, and(shr(21, inst), 0x3ff)))))), 0xffffffffffffffff)
                }
                case 0x67 {
                    if and(shr(12, inst), 7) { trap(at_pc, inst) }
                    mstore(rd, next)
                    next := and(add(a, sar(244, shl(224, inst))), 0xfffffffffffffffe)
                }
                case 0x37 { mstore(rd, and(signextend(3, and(inst, 0xfffff000)), 0xffffffffffffffff)) }
                case 0x17 { mstore(rd, and(add(at_pc, signextend(3, and(inst, 0xfffff000))), 0xffffffffffffffff)) }
                case 0x73 {
                    if iszero(eq(inst, 0x73)) { trap(at_pc, inst) }
                    if host() { break }
                }
                default { trap(at_pc, inst) }
                mstore(0x80, 0)                              // x0 is always zero
                at_pc := next
            }
            mstore(0x22520, count)
            mstore(0x22540, 0x60)
            return(0x22500, add(0x80, and(add(mload(0x22560), 31), not(31))))
        }
    }

    /// Runs Phil's server over one upload for real: reverts unless it is ACCEPTED, and counts it.
    function submit(bytes calldata upload) external returns (uint256 number) {
        (uint256 code,,) = this.run(upload);
        if (code != 0) revert Refused(code);
        number = ++accepted;
        emit Accepted(msg.sender, sha256(upload), number);
    }
}
