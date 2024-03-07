target datalayout = "e-m:e-p:32:32-i64:64-n32:64-S128"
target triple = "wasm32"

declare void @SKIP_print_last_exception_stack_trace_and_exit(ptr)
declare void @SKIP_throw(ptr)
declare void @SKIP_unreachableMethodCall(ptr, ptr)
declare void @SKIP_unreachableWithExplanation(ptr)
declare ptr @SKIP_intern(ptr)
declare void @SKIP_llvm_memcpy(ptr, ptr, i64)

; LLVM intrinsics

declare void @llvm.lifetime.start(i64, ptr nocapture) argmemonly nounwind
declare void @llvm.lifetime.end(i64, ptr nocapture) argmemonly nounwind

declare i32 @llvm.eh.typeid.for(ptr) nounwind readnone

declare i64 @llvm.ctlz.i64(i64, i1)
declare i64 @llvm.cttz.i64(i64, i1)
declare i64 @llvm.ctpop.i64(i64)

declare i32 @__gxx_personality_v0(...)
declare ptr @__cxa_begin_catch(ptr)
declare void @__cxa_end_catch()

; Function Attrs: alwaysinline nounwind uwtable
define void @SKIP_debug_break() {
  ret void
}

; Obstack

declare ptr @SKIP_Obstack_alloc(i32)
declare ptr @SKIP_Obstack_calloc(i32)
declare void @SKIP_Obstack_vectorUnsafeSet(ptr, ptr)
declare void @SKIP_Obstack_collect(ptr, ptr, i64)
declare ptr @SKIP_Obstack_shallowClone(i32, ptr)

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

; String

declare ptr @SKIP_String_concat2(ptr, ptr)
declare i64 @SKIP_String_cmp(ptr, ptr)
declare ptr @SKIP_Float_toString(double)

; Function Attrs: noinline nounwind optnone
define i1 @SKIP_String_eq(ptr %0, ptr %1) {
  %3 = call i64 @SKIP_String_cmp(ptr %0, ptr %1)
  %4 = icmp eq i64 %3, 0
  ret i1 %4
}


; Exception

@_ZTIN4skip13SkipExceptionE = external constant { ptr, ptr, ptr }, align 8

declare void @SKIP_saveExn(ptr)
declare void @SKIP_etry(ptr, ptr)
