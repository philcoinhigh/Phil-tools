; Phil canonical pre-optimization LLVM artifact
; llvm-language=LLVM IR 18 opaque-pointer subset
; llvm-tool=llvm-as 18.x expected
; compilation-profile=certified-release
; runtime-abi-profile=phil-runtime/phase0/reference-v1
; runtime-abi-digest=d6a51047143f732f8de5c2f45551cdebd76b48774672306d911a3ed5886014bd
source_filename = "runnable-main-preopt"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"


define i32 @main() {
block_entry:
  %source_value_answer = add i32 0, 42
  ret i32 %source_value_answer
}
