target triple = "x86_64-pc-linux-gnu"

declare ptr @SKIP_Obstack_alloc(i64)
declare ptr @SKIP_Obstack_calloc(i64) #0
declare ptr @SKIP_Int_toString(i64) #0
declare i1 @SKIP_String__contains(ptr, ptr)
declare ptr @SKIP_String_concat2(ptr, ptr)
declare void @SKIP_print_last_exception_stack_trace_and_exit(ptr)
declare void @SKIP_throw(ptr)
declare void @SKIP_unreachableMethodCall(ptr, ptr)
declare void @SKIP_unreachableWithExplanation(ptr)
declare ptr @SKIP_Array_concatStringArray(ptr)
declare i64 @SKIP_String_StringIterator__rawNext(ptr)
declare i64 @SKIP_String_StringIterator__rawPrev(ptr)
declare ptr @SKIP_String_StringIterator__substring(ptr, ptr)
declare ptr @SKIP_String__fromChars(ptr, ptr)
declare i64 @SKIP_String__length(ptr)
declare i64 @SKIP_Unsafe_string_utf8_size(ptr)
declare void @SKIP_print_error(ptr)
declare void @SKIP_Obstack_vectorUnsafeSet(ptr, ptr)
declare void @SKIP_print_raw(ptr)
declare void @SKIP_print_error_raw(ptr)
declare void @SKIP_Obstack_collect(ptr, ptr, i64)
declare ptr @SKIP_Obstack_shallowClone(i64, ptr)
declare i64 @SKIP_String_StringIterator__rawCurrent(ptr)
declare void @SKIP_String_StringIterator__rawDrop(ptr, i64)
declare i64 @SKIP_String_cmp(ptr, ptr)
declare {i64, i64} @SKIP_String_toIntOptionHelper(ptr)
declare ptr @SKIP_intern(ptr)
declare void @SKIP_exit(i64)
declare void @SKIP_llvm_memcpy(ptr, ptr, i64)
declare ptr @SKIP_read_line()
declare ptr @SKIP_read_to_end()
declare void @SKIP_drop(ptr)
declare i32 @SKIP_String_getByte(ptr, i64)
declare i32 @SKIP_String_byteSize(ptr)
declare ptr @SKIP_Float_toString(double)
declare double @SKIP_String__toFloat_raw(ptr)
declare void @SKIP_FileSystem_appendTextFile(ptr, ptr)
declare ptr @SKIP_System_subprocess(ptr)
declare void @llvm.debugtrap() nounwind

; LLVM

declare void @llvm.lifetime.start(i64, ptr nocapture) argmemonly nounwind
declare void @llvm.lifetime.end(i64, ptr nocapture) argmemonly nounwind

declare i32 @llvm.eh.typeid.for(ptr) nounwind readnone

declare i64 @llvm.ctlz.i64(i64, i1)
declare i64 @llvm.cttz.i64(i64, i1)
declare i64 @llvm.ctpop.i64(i64)

declare double @llvm.sin.f64(double %Val)
declare double @llvm.cos.f64(double %Val)
declare double @llvm.floor.f64(double %Val)
declare double @llvm.ceil.f64(double %Val)
declare double @llvm.round.f64(double %Val)
declare double @llvm.sqrt.f64(double %Val)
declare double @llvm.pow.f64(double %Val, double %Power)

declare i32 @__gxx_personality_v0(...)
declare ptr @__cxa_begin_catch(ptr)
declare void @__cxa_end_catch()

@_ZTIN4skip13SkipExceptionE = external constant { ptr, ptr, ptr }, align 8

; Awaitable

define void @SKIP_awaitableNotifyWaitersValueIsReady(ptr) {
  ret void
}

define void @SKIP_awaitableSyncOrThrow(ptr) {
  ret void
}

define void @SKIP_awaitableThrow(ptr, ptr) {
  ret void
}

; Obstack code

; Function Attrs: alwaysinline nounwind uwtable
define void @SKIP_Obstack_inl_collect(ptr, ptr, i64) {
  ret void
}

; Function Attrs: alwaysinline nounwind uwtable
define ptr @SKIP_Obstack_note_inl() {
  ret ptr null
}

; Function Attrs: alwaysinline nounwind uwtable
define void @SKIP_Obstack_inl_collect0(ptr) {
  ret void
}

; Function Attrs: alwaysinline nounwind uwtable
define ptr @SKIP_Obstack_inl_collect1(ptr, ptr) {
  ret ptr %1
}

; Function Attrs: alwaysinline nounwind uwtable
define void @SKIP_Obstack_store(ptr %obj, ptr %val) {
  store ptr %val, ptr %obj
  ret void
}

; Function Attrs: alwaysinline nounwind uwtable
define void @SKIP_debug_break() {
  tail call void @llvm.debugtrap()
  ret void
}

; Function Attrs: noinline nounwind optnone
define i1 @SKIP_String_eq(ptr %0, ptr %1) #0 {
  %3 = call i64 @SKIP_String_cmp(ptr %0, ptr %1)
  %4 = icmp eq i64 %3, 0
  ret i1 %4
}

declare void @SKIP_saveExn(ptr)

define void @SKIP_etry(ptr %f.0, ptr %onError.1) unnamed_addr uwtable personality ptr bitcast (i32 (...)* @__gxx_personality_v0 to ptr) {
b0.entry:
  %r20 = getelementptr inbounds i8, ptr %f.0, i64 -8
  %r21 = bitcast ptr %r20 to ptr
  %r2 = load ptr, ptr %r21, align 8
  %r22 = getelementptr inbounds i8, ptr %r2, i64 0
  %r23 = bitcast ptr %r22 to ptr
  %r3 = load ptr, ptr %r23, align 8
  %methodCode.24 = bitcast ptr %r3 to void(ptr) *
  invoke void %methodCode.24(ptr %f.0) to label %b6.exit unwind label %b1.rawcatch_5
b1.rawcatch_5:
  %excpair.25 = landingpad { ptr, i32 }
          catch ptr bitcast ({ ptr, ptr, ptr }* @_ZTIN4skip13SkipExceptionE to ptr)
  %caught_type_id.26 = extractvalue { ptr, i32 } %excpair.25, 1
  %expected_type_id.27 = tail call i32 @llvm.eh.typeid.for(ptr nonnull bitcast ({ ptr, ptr, ptr }* @_ZTIN4skip13SkipExceptionE to ptr)) nounwind
  %eq_type_id.28 = icmp eq i32 %caught_type_id.26, %expected_type_id.27
  br i1 %eq_type_id.28, label %catch.29, label %no_catch.30
no_catch.30:
  resume { ptr, i32 } %excpair.25
catch.29:
  %r31 = extractvalue { ptr, i32 } %excpair.25, 0
  %cpp_exc.32 = tail call ptr @__cxa_begin_catch(ptr %r31) nounwind
  %exc_field_addr1.33 = getelementptr inbounds i8, ptr %cpp_exc.32, i64 8
  %exc_field_addr2.34 = bitcast ptr %exc_field_addr1.33 to ptr
  %r8 = load ptr, ptr %exc_field_addr2.34, align 8
  tail call void @__cxa_end_catch()
  br label %b2.record_exc_5
b2.record_exc_5:
  tail call void @SKIP_saveExn(ptr %r8)
  %r35 = getelementptr inbounds i8, ptr %onError.1, i64 -8
  %r36 = bitcast ptr %r35 to ptr
  %r6 = load ptr, ptr %r36, align 8
  %r37 = getelementptr inbounds i8, ptr %r6, i64 0
  %r38 = bitcast ptr %r37 to ptr
  %r9 = load ptr, ptr %r38, align 8
  %methodCode.39 = bitcast ptr %r9 to void(ptr) *
  tail call void %methodCode.39(ptr %onError.1)
  ret void
b6.exit:
  ret void
}
