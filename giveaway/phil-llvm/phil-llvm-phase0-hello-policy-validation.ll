; Phil canonical pre-optimization LLVM artifact
; llvm-language=LLVM IR 18 opaque-pointer subset
; llvm-tool=llvm-as 18.x expected
; compilation-profile=certified-release
; runtime-abi-profile=phil-runtime/phase0/hello-policy-validation-v1
; runtime-abi-digest=a49ca08ba4b95117240c147a394d1fa871f4e251ff89e57c3538343b20d0d092
source_filename = "phase0-upload-preopt"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i1 @phil_branch_condition()
declare void @phil_cleanup()
declare void @phil_buffer_release(ptr)
declare i1 @phil_runtime_digest_validate(ptr, ptr)
declare { i8, ptr } @phil_runtime_store(ptr)
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
declare i1 @phil_runtime_refine_selected_version(ptr, i16)
declare i1 @phil_runtime_validate_begin_policy(ptr, ptr, ptr)
declare void @phil_runtime_select_begin_policy_reject(ptr, i8)
declare void @phil_runtime_select_begin_policy_proceed(ptr)
declare i1 @phil_runtime_receive_begin_policy_choice(ptr, ptr)
declare i1 @phil_runtime_validate_hello_policy(ptr, ptr, ptr)
declare void @phil_runtime_fail_hello_policy(ptr, ptr)
declare void @phil_call_receive_frame_Begin()
declare void @phil_call_receive_frame_Hello()
declare void @phil_call_send_Begin()
declare void @phil_call_send_Hello()
declare void @phil_call_should_cancel_upload()
declare i1 @phil_runtime_send_exact()
declare i64 @phil_record_Begin_get_length(ptr)
declare ptr @phil_record_Hello_get_versions(ptr)
declare { i8, ptr } @phil_runtime_recognize_Begin()
declare { i8, ptr } @phil_runtime_recognize_Hello()
declare { i8, ptr } @phil_runtime_receive_exact_u64(ptr, i64)

define i32 @UploadClient(ptr %client_transport) {
client_entry:
  call void @phil_call_send_Hello()
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
  ; runtime send_exact
  call i1 @phil_runtime_send_exact()
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
  call void @phil_call_send_Begin()
  %phil_begin_policy_choice_reason_slot_client_begin_reject_reason = alloca i8
  %phil_begin_policy_proceed_client_version = call i1 @phil_runtime_receive_begin_policy_choice(ptr %client_transport, ptr %phil_begin_policy_choice_reason_slot_client_begin_reject_reason)
  br i1 %phil_begin_policy_proceed_client_version, label %client_proceed, label %client_reject
client_version_check:
  %client_selected_version = load i16, ptr %phil_version_choice_slot_client_selected_version
  %phil_version_refinement_ok_client_version_check = call i1 @phil_runtime_refine_selected_version(ptr %client_transport, i16 %client_selected_version)
  br i1 %phil_version_refinement_ok_client_version_check, label %client_version, label %client_version_failure
client_version_failure:
  ret i32 0 ; fatal:VersionRefinementFailure
}

define i32 @UploadServer(ptr %server_policy_context, ptr %server_supported_versions, ptr %server_transport) {
server_entry:
  call void @phil_call_receive_frame_Hello()
  ; plain borrowed view; no representation copy
  %phil_recognition_result_server_entry = call { i8, ptr } @phil_runtime_recognize_Hello()
  %phil_recognition_status_server_entry = extractvalue { i8, ptr } %phil_recognition_result_server_entry, 0
  %server_hello = extractvalue { i8, ptr } %phil_recognition_result_server_entry, 1
  %phil_recognition_ok_server_entry = icmp eq i8 %phil_recognition_status_server_entry, 1
  br i1 %phil_recognition_ok_server_entry, label %server_hello_commit, label %server_hello_recognition_failure
server_accepted:
  call void @phil_runtime_select_accepted(ptr %server_transport, ptr %server_upload_id)
  ret i32 0 ; success
server_begin_commit:
  ; plain commit recognized ingress into CFG typestate
  %server_begin_length = call i64 @phil_record_Begin_get_length(ptr %server_begin)
  ; !phil proof/typestate fact erased before LLVM
  %phil_begin_policy_validation_reason_slot_server_begin_reject_reason = alloca i8
  %phil_begin_policy_accepted_server_begin_commit = call i1 @phil_runtime_validate_begin_policy(ptr %server_policy_context, ptr %server_begin, ptr %phil_begin_policy_validation_reason_slot_server_begin_reject_reason)
  br i1 %phil_begin_policy_accepted_server_begin_commit, label %server_proceed, label %server_reject
server_begin_recognition_failure:
  ; cleanup destroy pending ingress/frame
  call void @phil_cleanup()
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
  ; plain commit recognized ingress into CFG typestate
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
  call void @phil_runtime_select_begin_policy_proceed(ptr %server_transport)
  %phil_payload_cancel_is_payload_server_proceed = call i1 @phil_runtime_receive_payload_cancel(ptr %server_transport)
  br i1 %phil_payload_cancel_is_payload_server_proceed, label %server_payload, label %server_cancel
server_reject:
  %server_begin_reject_reason = load i8, ptr %phil_begin_policy_validation_reason_slot_server_begin_reject_reason
  call void @phil_runtime_select_begin_policy_reject(ptr %server_transport, i8 %server_begin_reject_reason)
  ret i32 0 ; failure
server_storage_failure:
  ret i32 0 ; fatal:StorageFailure
server_store:
  ; !phil proof/typestate fact erased before LLVM
  %phil_store_result_server_store = call { i8, ptr } @phil_runtime_store(ptr %server_payload_owner)
  %phil_store_status_server_store = extractvalue { i8, ptr } %phil_store_result_server_store, 0
  %server_upload_id = extractvalue { i8, ptr } %phil_store_result_server_store, 1
  %phil_store_ok_server_store = icmp eq i8 %phil_store_status_server_store, 1
  br i1 %phil_store_ok_server_store, label %server_accepted, label %server_storage_failure
server_unsupported:
  call void @phil_runtime_select_unsupported(ptr %server_transport)
  ret i32 0 ; failure
server_version:
  %server_selected_version = load i16, ptr %phil_choose_supported_slot_server_selected_version
  call void @phil_runtime_select_version(ptr %server_transport, i16 %server_selected_version)
  ; !phil proof/typestate fact erased before LLVM
  call void @phil_call_receive_frame_Begin()
  ; plain borrowed view; no representation copy
  %phil_recognition_result_server_version = call { i8, ptr } @phil_runtime_recognize_Begin()
  %phil_recognition_status_server_version = extractvalue { i8, ptr } %phil_recognition_result_server_version, 0
  %server_begin = extractvalue { i8, ptr } %phil_recognition_result_server_version, 1
  %phil_recognition_ok_server_version = icmp eq i8 %phil_recognition_status_server_version, 1
  br i1 %phil_recognition_ok_server_version, label %server_begin_commit, label %server_begin_recognition_failure
server_version_choose:
  %phil_choose_supported_slot_server_selected_version = alloca i16
  %phil_choose_supported_some_server_version_choose = call i1 @phil_runtime_choose_supported(ptr %server_supported_versions, ptr %server_hello_versions, ptr %phil_choose_supported_slot_server_selected_version)
  br i1 %phil_choose_supported_some_server_version_choose, label %server_version, label %server_unsupported
}

