//! Minimal Objective-C runtime bridge: objc_msgSend cast to concrete
//! signatures per call site. macOS/aarch64 only; every cast must match the
//! method's real signature exactly or we corrupt registers.

#![allow(non_snake_case)]

use std::ffi::{c_char, c_void, CString};

pub type Id = *mut c_void;
pub type Sel = *mut c_void;

#[repr(C)]
#[derive(Clone, Copy)]
pub struct MTLSize {
    pub width: usize,
    pub height: usize,
    pub depth: usize,
}

#[link(name = "objc")]
extern "C" {
    fn objc_getClass(name: *const c_char) -> Id;
    fn sel_registerName(name: *const c_char) -> Sel;
    fn objc_msgSend();
    pub fn objc_autoreleasePoolPush() -> *mut c_void;
    pub fn objc_autoreleasePoolPop(pool: *mut c_void);
}

#[link(name = "Metal", kind = "framework")]
extern "C" {
    pub fn MTLCreateSystemDefaultDevice() -> Id;
}

#[link(name = "Foundation", kind = "framework")]
extern "C" {}

pub fn class(name: &str) -> Id {
    let c = CString::new(name).unwrap();
    unsafe { objc_getClass(c.as_ptr()) }
}

pub fn sel(name: &str) -> Sel {
    let c = CString::new(name).unwrap();
    unsafe { sel_registerName(c.as_ptr()) }
}

macro_rules! msg {
    ($name:ident, ($($arg:ident: $ty:ty),*) -> $ret:ty) => {
        pub unsafe fn $name(obj: Id, sel: Sel, $($arg: $ty),*) -> $ret {
            let f: unsafe extern "C" fn(Id, Sel, $($ty),*) -> $ret =
                std::mem::transmute(objc_msgSend as *const c_void);
            f(obj, sel, $($arg),*)
        }
    };
}

msg!(msg0, () -> Id);
msg!(msg0_void, () -> ());
msg!(msg1, (a: Id) -> Id);
msg!(msg1_ptr, (a: *const c_void) -> Id);
msg!(msg2_id_err, (a: Id, b: *mut Id) -> Id);
msg!(msg3_lib, (a: Id, b: Id, c: *mut Id) -> Id);
msg!(msg3_buffer, (a: *const c_void, b: usize, c: usize) -> Id);
msg!(msg2_alloc, (a: usize, b: usize) -> Id);
msg!(msg3_setbuf, (a: Id, b: usize, c: usize) -> ());
msg!(msg3_setbytes, (a: *const c_void, b: usize, c: usize) -> ());
msg!(msg1_void_id, (a: Id) -> ());
msg!(msg2_dispatch, (a: MTLSize, b: MTLSize) -> ());

/// NSString from &str (autoreleased).
pub fn nsstring(s: &str) -> Id {
    let c = CString::new(s).unwrap();
    unsafe { msg1_ptr(class("NSString"), sel("stringWithUTF8String:"), c.as_ptr() as *const c_void) }
}

/// Rust String from NSString.
pub unsafe fn from_nsstring(ns: Id) -> String {
    if ns.is_null() {
        return "<null>".into();
    }
    let p = msg0(ns, sel("UTF8String")) as *const c_char;
    if p.is_null() {
        return "<null>".into();
    }
    std::ffi::CStr::from_ptr(p).to_string_lossy().into_owned()
}
