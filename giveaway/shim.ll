; Phil's module declares  { i8, ptr } @phil_runtime_receive_exact_u64(ptr, i64).
; This defines exactly that, in LLVM, so that the caller (Phil's code) and the callee agree on how
; the pair comes back whatever the target. The work is done by a C helper in runtime.c.
declare i8 @phil_draw_receive_exact(ptr, i64, ptr)

define { i8, ptr } @phil_runtime_receive_exact_u64(ptr %transport, i64 %length) {
entry:
  %slot = alloca ptr
  %status = call i8 @phil_draw_receive_exact(ptr %transport, i64 %length, ptr %slot)
  %payload = load ptr, ptr %slot
  %a = insertvalue { i8, ptr } undef, i8 %status, 0
  %b = insertvalue { i8, ptr } %a, ptr %payload, 1
  ret { i8, ptr } %b
}
