; Phil canonical pre-optimization LLVM artifact
; llvm-language=LLVM IR 18 opaque-pointer subset
; llvm-tool=llvm-as 18.x expected
; compilation-profile=certified-release
; runtime-abi-profile=phil-runtime/phase0/transport-exact-receive-v1
; runtime-abi-digest=dd6ae5a2e4af43fca2cca4b77b1ed45cdb43bd5b7432c7cd0bf2919e1aa9e889
source_filename = "phase0-upload-preopt"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i1 @phil_branch_condition()
declare void @phil_cleanup()
declare void @phil_buffer_release(ptr)
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
declare i1 @phil_runtime_digest_validate()
declare i1 @phil_runtime_recognize_Hello()
declare i1 @phil_runtime_refine_selected_version()
declare i1 @phil_runtime_send_exact()
declare i1 @phil_runtime_store()
declare i1 @phil_runtime_validate_BeginPolicy()
declare i1 @phil_runtime_validate_HelloPolicy()
declare i64 @phil_record_Begin_get_length(ptr)
declare { i8, ptr } @phil_runtime_recognize_Begin()
declare { i8, ptr } @phil_runtime_receive_exact_u64(ptr, i64)

define i32 @UploadClient(ptr %client_transport) {
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
  call i1 @phil_runtime_send_exact()
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
  %phil_runtime_cond_client_version_check = call i1 @phil_runtime_refine_selected_version()
  br i1 %phil_runtime_cond_client_version_check, label %client_version, label %client_version_failure
client_version_failure:
  ret i32 0 ; fatal:VersionRefinementFailure
}

define i32 @UploadServer(ptr %server_transport) {
server_entry:
  call void @phil_call_receive_frame_Hello()
  ; plain borrowed view; no representation copy
  ; runtime-branch RecognitionBoundary "Hello"
  %phil_runtime_cond_server_entry = call i1 @phil_runtime_recognize_Hello()
  br i1 %phil_runtime_cond_server_entry, label %server_hello_commit, label %server_hello_recognition_failure
server_accepted:
  call void @phil_call_select_accepted()
  ret i32 0 ; success
server_begin_commit:
  ; plain commit recognized ingress into CFG typestate
  %server_begin_length = call i64 @phil_record_Begin_get_length(ptr %server_begin)
  ; !phil proof/typestate fact erased before LLVM
  ; runtime-branch ValidationBoundary "BeginPolicy"
  %phil_runtime_cond_server_begin_commit = call i1 @phil_runtime_validate_BeginPolicy()
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
  %phil_runtime_cond_server_digest = call i1 @phil_runtime_digest_validate()
  br i1 %phil_runtime_cond_server_digest, label %server_store, label %server_digest_mismatch
server_digest_mismatch:
  call void @phil_buffer_release(ptr %server_payload_owner)
  call void @phil_call_select_rejected()
  ret i32 0 ; failure
server_early_eof:
  call void @phil_buffer_release(ptr %server_payload_owner)
  ret i32 0 ; fatal:EarlyEOF
server_hello_commit:
  ; plain commit recognized ingress into CFG typestate
  ; !phil proof/typestate fact erased before LLVM
  ; runtime-branch ValidationBoundary "HelloPolicy"
  %phil_runtime_cond_server_hello_commit = call i1 @phil_runtime_validate_HelloPolicy()
  br i1 %phil_runtime_cond_server_hello_commit, label %server_version_choose, label %server_hello_policy_failure
server_hello_policy_failure:
  ret i32 0 ; fatal:ValidationFailure[HelloPolicy]
server_hello_recognition_failure:
  ; cleanup destroy pending ingress/frame
  call void @phil_cleanup()
  ret i32 0 ; fatal:RecognitionFailure[Hello]
server_payload:
  %phil_exact_receive_result_server_payload = call { i8, ptr } @phil_runtime_receive_exact_u64(ptr %server_transport, i64 %server_begin_length)
  %phil_exact_receive_status_server_payload = extractvalue { i8, ptr } %phil_exact_receive_result_server_payload, 0
  %server_payload_owner = extractvalue { i8, ptr } %phil_exact_receive_result_server_payload, 1
  %phil_exact_receive_ok_server_payload = icmp eq i8 %phil_exact_receive_status_server_payload, 1
  br i1 %phil_exact_receive_ok_server_payload, label %server_digest, label %server_early_eof
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
  %phil_runtime_cond_server_store = call i1 @phil_runtime_store()
  br i1 %phil_runtime_cond_server_store, label %server_accepted, label %server_storage_failure
server_unsupported:
  call void @phil_call_select_unsupported()
  ret i32 0 ; failure
server_version:
  call void @phil_call_select_version()
  ; !phil proof/typestate fact erased before LLVM
  call void @phil_call_receive_frame_Begin()
  ; plain borrowed view; no representation copy
  %phil_recognition_result_server_version = call { i8, ptr } @phil_runtime_recognize_Begin()
  %phil_recognition_status_server_version = extractvalue { i8, ptr } %phil_recognition_result_server_version, 0
  %server_begin = extractvalue { i8, ptr } %phil_recognition_result_server_version, 1
  %phil_recognition_ok_server_version = icmp eq i8 %phil_recognition_status_server_version, 1
  br i1 %phil_recognition_ok_server_version, label %server_begin_commit, label %server_begin_recognition_failure
server_version_choose:
  call void @phil_call_choose_supported()
  %phil_cond_server_version_choose = call i1 @phil_branch_condition()
  br i1 %phil_cond_server_version_choose, label %server_version, label %server_unsupported
}

