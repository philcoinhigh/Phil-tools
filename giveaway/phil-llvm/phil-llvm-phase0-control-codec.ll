; Phil canonical pre-optimization LLVM artifact
; llvm-language=LLVM IR 18 opaque-pointer subset
; llvm-tool=llvm-as 18.x expected
; compilation-profile=certified-release
; runtime-abi-profile=phil-runtime/phase0/control-codec-v1
; runtime-abi-digest=955c36a42af8104433e7c4a1c4289f36b189c84c7036b1c7249352a128d01dea
source_filename = "phase0-upload-preopt"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i1 @phil_branch_condition()
declare void @phil_cleanup()
declare void @phil_buffer_release(ptr)
declare i1 @phil_runtime_digest_validate(ptr, ptr)
declare i8 @phil_runtime_store_with_error(ptr, ptr, ptr)
declare void @phil_runtime_fail_storage(ptr, ptr)
declare void @phil_runtime_select_accepted(ptr, ptr)
declare void @phil_runtime_select_rejected(ptr, i8)
declare i1 @phil_runtime_receive_final_response(ptr, ptr)
declare void @phil_runtime_record_upload_id(ptr)
declare void @phil_runtime_select_payload_cancel(ptr, i8)
declare i1 @phil_runtime_receive_payload_cancel(ptr)
declare i1 @phil_runtime_choose_supported(ptr, ptr, ptr)
declare void @phil_runtime_select_unsupported(ptr)
declare void @phil_runtime_select_version(ptr, i16)
declare i1 @phil_runtime_receive_version_choice(ptr, ptr)
declare i1 @phil_runtime_validate_begin_policy(ptr, ptr, ptr)
declare void @phil_runtime_select_begin_policy_reject(ptr, i8)
declare void @phil_runtime_select_begin_policy_proceed(ptr)
declare i1 @phil_runtime_receive_begin_policy_choice(ptr, ptr)
declare i1 @phil_runtime_validate_hello_policy(ptr, ptr, ptr)
declare void @phil_runtime_fail_hello_policy(ptr, ptr)
declare ptr @phil_runtime_supported_versions()
declare i64 @phil_runtime_payload_length(ptr)
declare ptr @phil_runtime_payload_kind(ptr)
declare ptr @phil_runtime_sha256(ptr)
declare void @phil_runtime_send_hello(ptr, ptr)
declare void @phil_runtime_send_begin_sha256(ptr, i64, ptr, ptr)
declare i1 @phil_runtime_refine_selected_version_with_set(ptr, ptr, i16)
declare void @phil_runtime_send_exact(ptr, ptr)
declare void @phil_call_should_cancel_upload()
declare i64 @phil_record_Begin_get_length(ptr)
declare ptr @phil_record_Hello_get_versions(ptr)
declare void @phil_runtime_receive_frame_Begin(ptr, ptr, ptr)
declare ptr @phil_runtime_frame_borrow_view_Begin(ptr)
declare i8 @phil_runtime_recognize_Begin(ptr, ptr, ptr, ptr)
declare void @phil_runtime_commit_ingress_Begin(ptr, ptr)
declare void @phil_runtime_fail_recognition_Begin(ptr, ptr)
declare void @phil_runtime_destroy_pending_Begin(ptr, ptr)
declare void @phil_runtime_receive_frame_Hello(ptr, ptr, ptr)
declare ptr @phil_runtime_frame_borrow_view_Hello(ptr)
declare i8 @phil_runtime_recognize_Hello(ptr, ptr, ptr, ptr)
declare void @phil_runtime_commit_ingress_Hello(ptr, ptr)
declare void @phil_runtime_fail_recognition_Hello(ptr, ptr)
declare void @phil_runtime_destroy_pending_Hello(ptr, ptr)
declare { i8, ptr } @phil_runtime_receive_exact_u64(ptr, i64)

define i32 @UploadClient(ptr %client_transport, ptr %client_payload_owner) {
client_entry:
  %client_supported_versions = call ptr @phil_runtime_supported_versions()
  call void @phil_runtime_send_hello(ptr %client_transport, ptr %client_supported_versions)
  %phil_version_choice_slot_client_selected_version = alloca i16
  %phil_version_choice_is_version_client_entry = call i1 @phil_runtime_receive_version_choice(ptr %client_transport, ptr %phil_version_choice_slot_client_selected_version)
  br i1 %phil_version_choice_is_version_client_entry, label %client_version_check, label %client_unsupported
client_accepted:
  %client_upload_id = load ptr, ptr %phil_final_response_upload_id_slot_client_upload_id
  call void @phil_runtime_record_upload_id(ptr %client_upload_id)
  ret i32 0 ; success
client_cancel:
  call void @phil_runtime_select_payload_cancel(ptr %client_transport, i8 0)
  ; cleanup release owner
  call void @phil_cleanup()
  ret i32 0 ; cancelled
client_payload:
  call void @phil_runtime_select_payload_cancel(ptr %client_transport, i8 1)
  call void @phil_runtime_send_exact(ptr %client_transport, ptr %client_payload_owner)
  %phil_final_response_upload_id_slot_client_upload_id = alloca ptr
  %phil_final_response_accepted_client_payload = call i1 @phil_runtime_receive_final_response(ptr %client_transport, ptr %phil_final_response_upload_id_slot_client_upload_id)
  br i1 %phil_final_response_accepted_client_payload, label %client_accepted, label %client_rejected
client_proceed:
  call void @phil_call_should_cancel_upload()
  %phil_cond_client_proceed = call i1 @phil_branch_condition()
  br i1 %phil_cond_client_proceed, label %client_cancel, label %client_payload
client_reject:
  %client_begin_reject_reason = load i8, ptr %phil_begin_policy_choice_reason_slot_client_begin_reject_reason
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
  %client_declared_digest = call ptr @phil_runtime_sha256(ptr %client_payload_owner)
  %client_payload_length = call i64 @phil_runtime_payload_length(ptr %client_payload_owner)
  %client_payload_kind = call ptr @phil_runtime_payload_kind(ptr %client_payload_owner)
  call void @phil_runtime_send_begin_sha256(ptr %client_transport, i64 %client_payload_length, ptr %client_payload_kind, ptr %client_declared_digest)
  %phil_begin_policy_choice_reason_slot_client_begin_reject_reason = alloca i8
  %phil_begin_policy_proceed_client_version = call i1 @phil_runtime_receive_begin_policy_choice(ptr %client_transport, ptr %phil_begin_policy_choice_reason_slot_client_begin_reject_reason)
  br i1 %phil_begin_policy_proceed_client_version, label %client_proceed, label %client_reject
client_version_check:
  %client_selected_version = load i16, ptr %phil_version_choice_slot_client_selected_version
  %phil_version_refinement_ok_client_version_check = call i1 @phil_runtime_refine_selected_version_with_set(ptr %client_transport, ptr %client_supported_versions, i16 %client_selected_version)
  br i1 %phil_version_refinement_ok_client_version_check, label %client_version, label %client_version_failure
client_version_failure:
  ret i32 0 ; fatal:VersionRefinementFailure
}

define i32 @UploadServer(ptr %server_policy_context, ptr %server_supported_versions, ptr %server_transport) {
server_entry:
  %phil_pending_slot_server_pending_hello = alloca ptr
  %phil_frame_slot_server_frame_hello = alloca ptr
  call void @phil_runtime_receive_frame_Hello(ptr %server_transport, ptr %phil_pending_slot_server_pending_hello, ptr %phil_frame_slot_server_frame_hello)
  %server_pending_hello = load ptr, ptr %phil_pending_slot_server_pending_hello
  %server_frame_hello = load ptr, ptr %phil_frame_slot_server_frame_hello
  %server_raw_hello = call ptr @phil_runtime_frame_borrow_view_Hello(ptr %server_frame_hello)
  %phil_recognition_record_slot_server_hello = alloca ptr
  %phil_recognition_reason_slot_server_hello_recognition_reason = alloca ptr
  %phil_recognition_status_server_entry = call i8 @phil_runtime_recognize_Hello(ptr %server_pending_hello, ptr %server_raw_hello, ptr %phil_recognition_record_slot_server_hello, ptr %phil_recognition_reason_slot_server_hello_recognition_reason)
  %server_hello = load ptr, ptr %phil_recognition_record_slot_server_hello
  %server_hello_recognition_reason = load ptr, ptr %phil_recognition_reason_slot_server_hello_recognition_reason
  %phil_recognition_ok_server_entry = icmp eq i8 %phil_recognition_status_server_entry, 1
  br i1 %phil_recognition_ok_server_entry, label %server_hello_commit, label %server_hello_recognition_failure
server_accepted:
  call void @phil_runtime_select_accepted(ptr %server_transport, ptr %server_upload_id)
  ret i32 0 ; success
server_begin_commit:
  call void @phil_runtime_commit_ingress_Begin(ptr %server_transport, ptr %server_pending_begin)
  %server_begin_length = call i64 @phil_record_Begin_get_length(ptr %server_begin)
  ; !phil proof/typestate fact erased before LLVM
  %phil_begin_policy_validation_reason_slot_server_begin_reject_reason = alloca i8
  %phil_begin_policy_accepted_server_begin_commit = call i1 @phil_runtime_validate_begin_policy(ptr %server_policy_context, ptr %server_begin, ptr %phil_begin_policy_validation_reason_slot_server_begin_reject_reason)
  br i1 %phil_begin_policy_accepted_server_begin_commit, label %server_proceed, label %server_reject
server_begin_recognition_failure:
  call void @phil_runtime_fail_recognition_Begin(ptr %server_pending_begin, ptr %server_begin_recognition_reason)
  call void @phil_runtime_destroy_pending_Begin(ptr %server_pending_begin, ptr %server_frame_begin)
  ret i32 0 ; fatal:RecognitionFailure[Begin]
server_cancel:
  ret i32 0 ; cancelled
server_digest:
  ; plain borrowed view; no representation copy
  ; !phil proof/typestate fact erased before LLVM
  %phil_digest_ok_server_digest = call i1 @phil_runtime_digest_validate(ptr %server_begin, ptr %server_payload_owner)
  br i1 %phil_digest_ok_server_digest, label %server_store, label %server_digest_mismatch
server_digest_mismatch:
  call void @phil_buffer_release(ptr %server_payload_owner)
  call void @phil_runtime_select_rejected(ptr %server_transport, i8 1)
  ret i32 0 ; failure
server_early_eof:
  call void @phil_buffer_release(ptr %server_payload_owner)
  ret i32 0 ; fatal:EarlyEOF
server_hello_commit:
  call void @phil_runtime_commit_ingress_Hello(ptr %server_transport, ptr %server_pending_hello)
  %server_hello_versions = call ptr @phil_record_Hello_get_versions(ptr %server_hello)
  ; !phil proof/typestate fact erased before LLVM
  %phil_hello_policy_validation_reason_slot_server_hello_reject_reason = alloca ptr
  %phil_hello_policy_accepted_server_hello_commit = call i1 @phil_runtime_validate_hello_policy(ptr %server_policy_context, ptr %server_hello, ptr %phil_hello_policy_validation_reason_slot_server_hello_reject_reason)
  br i1 %phil_hello_policy_accepted_server_hello_commit, label %server_version_choose, label %server_hello_policy_failure
server_hello_policy_failure:
  %server_hello_reject_reason = load ptr, ptr %phil_hello_policy_validation_reason_slot_server_hello_reject_reason
  call void @phil_runtime_fail_hello_policy(ptr %server_transport, ptr %server_hello_reject_reason)
  ret i32 0 ; fatal:ValidationFailure[HelloPolicy]
server_hello_recognition_failure:
  call void @phil_runtime_fail_recognition_Hello(ptr %server_pending_hello, ptr %server_hello_recognition_reason)
  call void @phil_runtime_destroy_pending_Hello(ptr %server_pending_hello, ptr %server_frame_hello)
  ret i32 0 ; fatal:RecognitionFailure[Hello]
server_payload:
  %phil_exact_receive_result_server_payload = call { i8, ptr } @phil_runtime_receive_exact_u64(ptr %server_transport, i64 %server_begin_length)
  %phil_exact_receive_status_server_payload = extractvalue { i8, ptr } %phil_exact_receive_result_server_payload, 0
  %server_payload_owner = extractvalue { i8, ptr } %phil_exact_receive_result_server_payload, 1
  %phil_exact_receive_ok_server_payload = icmp eq i8 %phil_exact_receive_status_server_payload, 1
  br i1 %phil_exact_receive_ok_server_payload, label %server_digest, label %server_early_eof
server_proceed:
  call void @phil_runtime_select_begin_policy_proceed(ptr %server_transport)
  %phil_payload_cancel_is_payload_server_proceed = call i1 @phil_runtime_receive_payload_cancel(ptr %server_transport)
  br i1 %phil_payload_cancel_is_payload_server_proceed, label %server_payload, label %server_cancel
server_reject:
  %server_begin_reject_reason = load i8, ptr %phil_begin_policy_validation_reason_slot_server_begin_reject_reason
  call void @phil_runtime_select_begin_policy_reject(ptr %server_transport, i8 %server_begin_reject_reason)
  ret i32 0 ; failure
server_storage_failure:
  call void @phil_runtime_fail_storage(ptr %server_transport, ptr %server_storage_error)
  ret i32 0 ; fatal:StorageFailure
server_store:
  ; !phil proof/typestate fact erased before LLVM
  %phil_store_upload_slot_server_upload_id = alloca ptr
  %phil_store_error_slot_server_storage_error = alloca ptr
  store ptr null, ptr %phil_store_upload_slot_server_upload_id
  store ptr null, ptr %phil_store_error_slot_server_storage_error
  %phil_store_status_server_store = call i8 @phil_runtime_store_with_error(ptr %server_payload_owner, ptr %phil_store_upload_slot_server_upload_id, ptr %phil_store_error_slot_server_storage_error)
  %server_upload_id = load ptr, ptr %phil_store_upload_slot_server_upload_id
  %server_storage_error = load ptr, ptr %phil_store_error_slot_server_storage_error
  %phil_store_ok_server_store = icmp eq i8 %phil_store_status_server_store, 1
  br i1 %phil_store_ok_server_store, label %server_accepted, label %server_storage_failure
server_unsupported:
  call void @phil_runtime_select_unsupported(ptr %server_transport)
  ret i32 0 ; failure
server_version:
  %server_selected_version = load i16, ptr %phil_choose_supported_slot_server_selected_version
  call void @phil_runtime_select_version(ptr %server_transport, i16 %server_selected_version)
  ; !phil proof/typestate fact erased before LLVM
  %phil_pending_slot_server_pending_begin = alloca ptr
  %phil_frame_slot_server_frame_begin = alloca ptr
  call void @phil_runtime_receive_frame_Begin(ptr %server_transport, ptr %phil_pending_slot_server_pending_begin, ptr %phil_frame_slot_server_frame_begin)
  %server_pending_begin = load ptr, ptr %phil_pending_slot_server_pending_begin
  %server_frame_begin = load ptr, ptr %phil_frame_slot_server_frame_begin
  %server_raw_begin = call ptr @phil_runtime_frame_borrow_view_Begin(ptr %server_frame_begin)
  %phil_recognition_record_slot_server_begin = alloca ptr
  %phil_recognition_reason_slot_server_begin_recognition_reason = alloca ptr
  %phil_recognition_status_server_version = call i8 @phil_runtime_recognize_Begin(ptr %server_pending_begin, ptr %server_raw_begin, ptr %phil_recognition_record_slot_server_begin, ptr %phil_recognition_reason_slot_server_begin_recognition_reason)
  %server_begin = load ptr, ptr %phil_recognition_record_slot_server_begin
  %server_begin_recognition_reason = load ptr, ptr %phil_recognition_reason_slot_server_begin_recognition_reason
  %phil_recognition_ok_server_version = icmp eq i8 %phil_recognition_status_server_version, 1
  br i1 %phil_recognition_ok_server_version, label %server_begin_commit, label %server_begin_recognition_failure
server_version_choose:
  %phil_choose_supported_slot_server_selected_version = alloca i16
  %phil_choose_supported_some_server_version_choose = call i1 @phil_runtime_choose_supported(ptr %server_supported_versions, ptr %server_hello_versions, ptr %phil_choose_supported_slot_server_selected_version)
  br i1 %phil_choose_supported_some_server_version_choose, label %server_version, label %server_unsupported
}

