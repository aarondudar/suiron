//! Metal GPU backend. MSL compiled at runtime, dispatched through the
//! hand-rolled objc bridge. Unified memory: buffers are storageModeShared,
//! so "upload"/"read" are memcpys, never PCIe transfers.

mod objc;
pub mod forward;

pub use forward::GpuModel;

use objc::*;
use std::ffi::c_void;

const MSL: &str = include_str!("kernels.metal");

pub struct Gpu {
    device: Id,
    queue: Id,
    matvec_pipe: Id,
    rmsnorm_pipe: Id,
    softmax_pipe: Id,
    // cached selectors (registration is cheap but this is the hot path)
    s_command_buffer: Sel,
    s_encoder: Sel,
    s_set_pipe: Sel,
    s_set_buffer: Sel,
    s_set_bytes: Sel,
    s_dispatch: Sel,
    s_end: Sel,
    s_commit: Sel,
    s_wait: Sel,
}

pub struct GpuBuf {
    buf: Id,
    pub len: usize, // f32 elements
}

impl Drop for GpuBuf {
    fn drop(&mut self) {
        unsafe { msg0_void(self.buf, sel("release")) }
    }
}

impl Gpu {
    pub fn new() -> Result<Self, String> {
        unsafe {
            let device = MTLCreateSystemDefaultDevice();
            if device.is_null() {
                return Err("no Metal device".into());
            }
            let queue = msg0(device, sel("newCommandQueue"));
            if queue.is_null() {
                return Err("newCommandQueue failed".into());
            }

            let mut err: Id = std::ptr::null_mut();
            let lib = msg3_lib(
                device,
                sel("newLibraryWithSource:options:error:"),
                nsstring(MSL),
                std::ptr::null_mut(),
                &mut err,
            );
            if lib.is_null() {
                let desc = msg0(err, sel("localizedDescription"));
                return Err(format!("MSL compile failed: {}", from_nsstring(desc)));
            }

            let pipeline = |name: &str| -> Result<Id, String> {
                let func = msg1(lib, sel("newFunctionWithName:"), nsstring(name));
                if func.is_null() {
                    return Err(format!("kernel {name} not found"));
                }
                let mut err: Id = std::ptr::null_mut();
                let pipe = msg2_id_err(
                    device,
                    sel("newComputePipelineStateWithFunction:error:"),
                    func,
                    &mut err,
                );
                if pipe.is_null() {
                    let desc = msg0(err, sel("localizedDescription"));
                    return Err(format!("pipeline {name} failed: {}", from_nsstring(desc)));
                }
                Ok(pipe)
            };

            Ok(Self {
                matvec_pipe: pipeline("matvec_f32")?,
                rmsnorm_pipe: pipeline("rmsnorm_f32")?,
                softmax_pipe: pipeline("softmax_f32")?,
                device,
                queue,
                s_command_buffer: sel("commandBuffer"),
                s_encoder: sel("computeCommandEncoder"),
                s_set_pipe: sel("setComputePipelineState:"),
                s_set_buffer: sel("setBuffer:offset:atIndex:"),
                s_set_bytes: sel("setBytes:length:atIndex:"),
                s_dispatch: sel("dispatchThreadgroups:threadsPerThreadgroup:"),
                s_end: sel("endEncoding"),
                s_commit: sel("commit"),
                s_wait: sel("waitUntilCompleted"),
            })
        }
    }

    /// Copy an f32 slice into a new shared-memory GPU buffer.
    pub fn upload(&self, data: &[f32]) -> GpuBuf {
        unsafe {
            let buf = msg3_buffer(
                self.device,
                sel("newBufferWithBytes:length:options:"),
                data.as_ptr() as *const c_void,
                std::mem::size_of_val(data),
                0, // MTLResourceStorageModeShared
            );
            assert!(!buf.is_null(), "buffer alloc failed ({} bytes)", data.len() * 4);
            GpuBuf { buf, len: data.len() }
        }
    }

    pub fn alloc(&self, len: usize) -> GpuBuf {
        unsafe {
            let buf = msg2_alloc(self.device, sel("newBufferWithLength:options:"), len * 4, 0);
            assert!(!buf.is_null(), "buffer alloc failed ({len} f32)");
            GpuBuf { buf, len }
        }
    }

    fn contents(&self, b: &GpuBuf) -> *mut f32 {
        unsafe { msg0(b.buf, sel("contents")) as *mut f32 }
    }

    pub fn write(&self, b: &GpuBuf, data: &[f32]) {
        assert!(data.len() <= b.len);
        unsafe { std::ptr::copy_nonoverlapping(data.as_ptr(), self.contents(b), data.len()) }
    }

    pub fn read(&self, b: &GpuBuf, out: &mut [f32]) {
        assert!(out.len() <= b.len);
        unsafe { std::ptr::copy_nonoverlapping(self.contents(b), out.as_mut_ptr(), out.len()) }
    }

    /// y = W·x for row-major W (rows × cols). Blocking.
    pub fn matvec(&self, w: &GpuBuf, x: &GpuBuf, y: &GpuBuf, rows: usize, cols: usize) {
        debug_assert!(w.len >= rows * cols && x.len >= cols && y.len >= rows);
        unsafe {
            let pool = objc_autoreleasePoolPush();
            let cmd = msg0(self.queue, self.s_command_buffer);
            let enc = msg0(cmd, self.s_encoder);
            msg1_void_id(enc, self.s_set_pipe, self.matvec_pipe);
            msg3_setbuf(enc, self.s_set_buffer, w.buf, 0, 0);
            msg3_setbuf(enc, self.s_set_buffer, x.buf, 0, 1);
            msg3_setbuf(enc, self.s_set_buffer, y.buf, 0, 2);
            let dims = [rows as u32, cols as u32];
            msg3_setbytes(
                enc,
                self.s_set_bytes,
                dims.as_ptr() as *const c_void,
                8,
                3,
            );
            const TG: usize = 64;
            msg2_dispatch(
                enc,
                self.s_dispatch,
                MTLSize { width: rows.div_ceil(TG), height: 1, depth: 1 },
                MTLSize { width: TG, height: 1, depth: 1 },
            );
            msg0_void(enc, self.s_end);
            msg0_void(cmd, self.s_commit);
            msg0_void(cmd, self.s_wait);
            objc_autoreleasePoolPop(pool);
        }
    }

    /// Single-threadgroup elementwise kernels (rmsnorm/softmax). 256 threads.
    fn dispatch_1tg(&self, pipe: Id, bufs: &[&GpuBuf], len: u32, eps: Option<f32>) {
        unsafe {
            let pool = objc_autoreleasePoolPush();
            let cmd = msg0(self.queue, self.s_command_buffer);
            let enc = msg0(cmd, self.s_encoder);
            msg1_void_id(enc, self.s_set_pipe, pipe);
            for (i, b) in bufs.iter().enumerate() {
                msg3_setbuf(enc, self.s_set_buffer, b.buf, 0, i);
            }
            let mut idx = bufs.len();
            msg3_setbytes(enc, self.s_set_bytes, (&len as *const u32).cast(), 4, idx);
            idx += 1;
            if let Some(e) = eps {
                msg3_setbytes(enc, self.s_set_bytes, (&e as *const f32).cast(), 4, idx);
            }
            msg2_dispatch(
                enc,
                self.s_dispatch,
                MTLSize { width: 1, height: 1, depth: 1 },
                MTLSize { width: 256, height: 1, depth: 1 },
            );
            msg0_void(enc, self.s_end);
            msg0_void(cmd, self.s_commit);
            msg0_void(cmd, self.s_wait);
            objc_autoreleasePoolPop(pool);
        }
    }

    pub fn rmsnorm(&self, x: &GpuBuf, w: &GpuBuf, y: &GpuBuf, len: usize, eps: f32) {
        self.dispatch_1tg(self.rmsnorm_pipe, &[x, w, y], len as u32, Some(eps));
    }

    pub fn softmax(&self, x: &GpuBuf, y: &GpuBuf, len: usize) {
        self.dispatch_1tg(self.softmax_pipe, &[x, y], len as u32, None);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gpu_rmsnorm_and_softmax_match_cpu() {
        let gpu = Gpu::new().expect("Metal device");
        let x: Vec<f32> = (0..1024).map(|i| ((i * 31 % 97) as f32 - 48.0) / 10.0).collect();
        let w: Vec<f32> = (0..1024).map(|i| 0.5 + (i % 7) as f32 * 0.1).collect();

        let (xb, wb, yb) = (gpu.upload(&x), gpu.upload(&w), gpu.alloc(1024));
        gpu.rmsnorm(&xb, &wb, &yb, 1024, 1e-6);
        let mut got = vec![0.0f32; 1024];
        gpu.read(&yb, &mut got);
        let want = suiron_core::math::rmsnorm(&x, &w, 1e-6);
        for (g, w) in got.iter().zip(&want) {
            assert!((g - w).abs() < 1e-4, "rmsnorm: {g} vs {w}");
        }

        gpu.softmax(&xb, &yb, 1024);
        gpu.read(&yb, &mut got);
        let want = suiron_core::math::softmax(&x);
        for (g, w) in got.iter().zip(&want) {
            assert!((g - w).abs() < 1e-5, "softmax: {g} vs {w}");
        }
    }

    #[test]
    fn gpu_matvec_matches_cpu() {
        let gpu = Gpu::new().expect("Metal device");
        // deterministic pseudo-random 67×129 (odd sizes to catch bounds bugs)
        let (rows, cols) = (67usize, 129usize);
        let w: Vec<f32> = (0..rows * cols).map(|i| ((i * 37 % 101) as f32 - 50.0) / 50.0).collect();
        let x: Vec<f32> = (0..cols).map(|i| ((i * 53 % 89) as f32 - 44.0) / 44.0).collect();

        let wb = gpu.upload(&w);
        let xb = gpu.upload(&x);
        let yb = gpu.alloc(rows);
        gpu.matvec(&wb, &xb, &yb, rows, cols);
        let mut got = vec![0.0f32; rows];
        gpu.read(&yb, &mut got);

        let want = suiron_core::math::matmul(&w, &x, rows, cols, 1);
        for (i, (g, w)) in got.iter().zip(&want).enumerate() {
            assert!((g - w).abs() < 1e-4, "row {i}: gpu {g} cpu {w}");
        }
    }
}
