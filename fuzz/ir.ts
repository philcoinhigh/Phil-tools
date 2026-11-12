// Reads the result out of the LLVM that philc emits for a scalar `main`.

/** Evaluates the tiny LLVM subset philc emits for a scalar main. Undefined if it is anything else. */
export function irResult(ir: string): { value: bigint } | { unit: true } | undefined {
  const body = /define i32 @main\(\) \{([\s\S]*?)\n\}/.exec(ir)?.[1];
  if (body === undefined) return undefined;
  const env = new Map<string, bigint>();
  const val = (t: string) => (t.startsWith("%") ? env.get(t) : /^-?\d+$/.test(t) ? BigInt(t) : undefined);
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line || line.endsWith(":")) continue;
    let m = /^(%[\w.]+) = add i32 (\S+), (\S+)$/.exec(line);
    if (m) { const a = val(m[2]), b = val(m[3]); if (a === undefined || b === undefined) return undefined; env.set(m[1], BigInt.asUintN(32, a + b)); continue; }
    m = /^ret i32 (\S+)( ; return-unit)?$/.exec(line);
    if (m) { if (m[2]) return { unit: true }; const v = val(m[1]); return v === undefined ? undefined : { value: BigInt.asUintN(32, v) }; }
    return undefined;
  }
  return undefined;
}
