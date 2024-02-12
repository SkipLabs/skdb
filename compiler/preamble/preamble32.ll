target datalayout = "e-m:e-p:32:32-i64:64-n32:64-S128"
target triple = "wasm32"

declare ptr @SKIP_Obstack_alloc(i32)
declare ptr @SKIP_Obstack_calloc(i32) #0
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
declare ptr @SKIP_Obstack_shallowClone(i32, ptr)
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
declare void @SKIP_etry(ptr, ptr)
declare ptr @SKIP_Float_toString(double)
declare double @SKIP_String__toFloat_raw(ptr)
declare void @SKIP_saveExn(ptr)
declare void @SKIP_FileSystem_appendTextFile(ptr, ptr)

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

; Delete after update_lkg
declare void @abort() noreturn

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
  ret void
}

; Function Attrs: noinline nounwind optnone
define i1 @SKIP_String_eq(ptr %0, ptr %1) #0 {
  %3 = alloca ptr, align 4
  %4 = alloca ptr, align 4
  store ptr %0, ptr %3, align 4
  store ptr %1, ptr %4, align 4
  %5 = load ptr, ptr %3, align 4
  %6 = load ptr, ptr %4, align 4
  %7 = call i64 @SKIP_String_cmp(ptr %5, ptr %6)
  %8 = icmp eq i64 %7, 0
  ret i1 %8
}
