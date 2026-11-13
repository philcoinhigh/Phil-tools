; Phil canonical pre-optimization LLVM artifact
; llvm-language=LLVM IR 18 opaque-pointer subset
; llvm-tool=llvm-as 18.x expected
; compilation-profile=certified-release
; runtime-abi-profile=phil-runtime/phase0/reference-v1
; runtime-abi-digest=d6a51047143f732f8de5c2f45551cdebd76b48774672306d911a3ed5886014bd
source_filename = "phase0-upload-preopt"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i1 @phil_branch_condition()
declare void @phil_cleanup()
declare void @phil_call_choose_supported()
declare void @phil_call_receive_accepted_rejected_label()
declare void @phil_call_receive_payload_cancel_label()
declare void @phil_call_receive_proceed_reject_label()
declare void @phil_call_receive_version_unsupported_label()
declare void @phil_call_receive_frame_Begin()
declare void @phil_call_receive_frame_Hello()
declare void @phil_call_select_accepted()
declare void @phil_call_select_cancel()
declare void @phil_call_select_payload()
declare void @phil_call_select_proceed()
declare void @phil_call_select_reject()
declare void @phil_call_select_rejected()
declare void @phil_call_select_unsupported()
declare void @phil_call_select_version()
declare void @phil_call_send_Begin()
declare void @phil_call_send_Hello()
declare void @phil_call_should_cancel_upload()
declare i1 @phil_runtime_evidence_upload_begin_policy_runtime()
declare i1 @phil_runtime_evidence_upload_digest_runtime()
declare i1 @phil_runtime_evidence_upload_hello_policy_runtime()
declare i1 @phil_runtime_evidence_upload_ingress_begin_runtime()
declare i1 @phil_runtime_evidence_upload_ingress_hello_runtime()
declare i1 @phil_runtime_evidence_upload_payload_receive_runtime()
declare i1 @phil_runtime_evidence_upload_payload_send_runtime()
declare i1 @phil_runtime_evidence_upload_storage_runtime()
declare i1 @phil_runtime_evidence_upload_version_client_runtime()

define i32 @UploadClient() {
client_entry:
  call void @phil_call_send_Hello()
  call void @phil_call_receive_version_unsupported_label()
  %phil_cond_client_entry = call i1 @phil_branch_condition()
  br i1 %phil_cond_client_entry, label %client_version_check, label %client_unsupported
client_accepted:
  ret i32 0 ; success
client_cancel:
  call void @phil_call_select_cancel()
  ; cleanup release owner
  call void @phil_cleanup()
  ret i32 0 ; cancelled
client_payload:
  call void @phil_call_select_payload()
  ; runtime send_exact
  call i1 @phil_runtime_evidence_upload_payload_send_runtime()
  call void @phil_call_receive_accepted_rejected_label()
  %phil_cond_client_payload = call i1 @phil_branch_condition()
  br i1 %phil_cond_client_payload, label %client_accepted, label %client_rejected
client_proceed:
  call void @phil_call_should_cancel_upload()
  %phil_cond_client_proceed = call i1 @phil_branch_condition()
  br i1 %phil_cond_client_proceed, label %client_cancel, label %client_payload
client_reject:
  ; cleanup release owner
  call void @phil_cleanup()
  ret i32 0 ; failure
client_rejected:
  ret i32 0 ; failure
client_unsupported:
  ; cleanup release owner
  call void @phil_cleanup()
  ret i32 0 ; failure
client_version:
  call void @phil_call_send_Begin()
  call void @phil_call_receive_proceed_reject_label()
  %phil_cond_client_version = call i1 @phil_branch_condition()
  br i1 %phil_cond_client_version, label %client_proceed, label %client_reject
client_version_check:
  ; runtime-branch BranchRefinementBoundary "selected-version"
  %phil_runtime_cond_client_version_check = call i1 @phil_runtime_evidence_upload_version_client_runtime()
  br i1 %phil_runtime_cond_client_version_check, label %client_version, label %client_version_failure
client_version_failure:
  ret i32 0 ; fatal:VersionRefinementFailure
}

define i32 @UploadServer() {
server_entry:
  call void @phil_call_receive_frame_Hello()
  ; plain borrowed view; no representation copy
  ; runtime-branch RecognitionBoundary "Hello"
  %phil_runtime_cond_server_entry = call i1 @phil_runtime_evidence_upload_ingress_hello_runtime()
  br i1 %phil_runtime_cond_server_entry, label %server_hello_commit, label %server_hello_recognition_failure
server_accepted:
  call void @phil_call_select_accepted()
  ret i32 0 ; success
server_begin_commit:
  ; plain commit recognized ingress into CFG typestate
  ; !phil proof/typestate fact erased before LLVM
  ; runtime-branch ValidationBoundary "BeginPolicy"
  %phil_runtime_cond_server_begin_commit = call i1 @phil_runtime_evidence_upload_begin_policy_runtime()
  br i1 %phil_runtime_cond_server_begin_commit, label %server_proceed, label %server_reject
server_begin_recognition_failure:
  ; cleanup destroy pending ingress/frame
  call void @phil_cleanup()
  ret i32 0 ; fatal:RecognitionFailure[Begin]
server_cancel:
  ret i32 0 ; cancelled
server_digest:
  ; plain borrowed view; no representation copy
  ; !phil proof/typestate fact erased before LLVM
  ; runtime-branch DigestBoundary
  %phil_runtime_cond_server_digest = call i1 @phil_runtime_evidence_upload_digest_runtime()
  br i1 %phil_runtime_cond_server_digest, label %server_store, label %server_digest_mismatch
server_digest_mismatch:
  ; cleanup release owner
  call void @phil_cleanup()
  call void @phil_call_select_rejected()
  ret i32 0 ; failure
server_early_eof:
  ; cleanup cleanup partial owner
  call void @phil_cleanup()
  ret i32 0 ; fatal:EarlyEOF
server_hello_commit:
  ; plain commit recognized ingress into CFG typestate
  ; !phil proof/typestate fact erased before LLVM
  ; runtime-branch ValidationBoundary "HelloPolicy"
  %phil_runtime_cond_server_hello_commit = call i1 @phil_runtime_evidence_upload_hello_policy_runtime()
  br i1 %phil_runtime_cond_server_hello_commit, label %server_version_choose, label %server_hello_policy_failure
server_hello_policy_failure:
  ret i32 0 ; fatal:ValidationFailure[HelloPolicy]
server_hello_recognition_failure:
  ; cleanup destroy pending ingress/frame
  call void @phil_cleanup()
  ret i32 0 ; fatal:RecognitionFailure[Hello]
server_payload:
  ; runtime-branch ExactReceiveBoundary
  %phil_runtime_cond_server_payload = call i1 @phil_runtime_evidence_upload_payload_receive_runtime()
  br i1 %phil_runtime_cond_server_payload, label %server_digest, label %server_early_eof
server_proceed:
  call void @phil_call_select_proceed()
  call void @phil_call_receive_payload_cancel_label()
  %phil_cond_server_proceed = call i1 @phil_branch_condition()
  br i1 %phil_cond_server_proceed, label %server_payload, label %server_cancel
server_reject:
  call void @phil_call_select_reject()
  ret i32 0 ; failure
server_storage_failure:
  ret i32 0 ; fatal:StorageFailure
server_store:
  ; !phil proof/typestate fact erased before LLVM
  ; runtime-branch StorageBoundary
  %phil_runtime_cond_server_store = call i1 @phil_runtime_evidence_upload_storage_runtime()
  br i1 %phil_runtime_cond_server_store, label %server_accepted, label %server_storage_failure
server_unsupported:
  call void @phil_call_select_unsupported()
  ret i32 0 ; failure
server_version:
  call void @phil_call_select_version()
  ; !phil proof/typestate fact erased before LLVM
  call void @phil_call_receive_frame_Begin()
  ; plain borrowed view; no representation copy
  ; runtime-branch RecognitionBoundary "Begin"
  %phil_runtime_cond_server_version = call i1 @phil_runtime_evidence_upload_ingress_begin_runtime()
  br i1 %phil_runtime_cond_server_version, label %server_begin_commit, label %server_begin_recognition_failure
server_version_choose:
  call void @phil_call_choose_supported()
  %phil_cond_server_version_choose = call i1 @phil_branch_condition()
  br i1 %phil_cond_server_version_choose, label %server_version, label %server_unsupported
}

