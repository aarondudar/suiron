#include <metal_stdlib>
using namespace metal;

// y = W·x, one thread per output row. dims = {rows, cols}.
kernel void matvec_f32(device const float*  W    [[buffer(0)]],
                       device const float*  x    [[buffer(1)]],
                       device float*        y    [[buffer(2)]],
                       constant uint2&      dims [[buffer(3)]],
                       uint gid [[thread_position_in_grid]]) {
    if (gid >= dims.x) return;
    const device float* w = W + (ulong)gid * dims.y;
    float acc = 0.0f;
    for (uint i = 0; i < dims.y; ++i) {
        acc += w[i] * x[i];
    }
    y[gid] = acc;
}

// Single-threadgroup RMSNorm: y = x * w / sqrt(mean(x²) + eps).
// dims = {len}; eps passed via buffer(4). One threadgroup, simd reduction.
kernel void rmsnorm_f32(device const float* x   [[buffer(0)]],
                        device const float* w   [[buffer(1)]],
                        device float*       y   [[buffer(2)]],
                        constant uint&      len [[buffer(3)]],
                        constant float&     eps [[buffer(4)]],
                        uint tid [[thread_position_in_threadgroup]],
                        uint tg_size [[threads_per_threadgroup]]) {
    threadgroup float partial[256];
    float acc = 0.0f;
    for (uint i = tid; i < len; i += tg_size) acc += x[i] * x[i];
    partial[tid] = acc;
    threadgroup_barrier(mem_flags::mem_threadgroup);
    for (uint s = tg_size / 2; s > 0; s >>= 1) {
        if (tid < s) partial[tid] += partial[tid + s];
        threadgroup_barrier(mem_flags::mem_threadgroup);
    }
    float inv = rsqrt(partial[0] / float(len) + eps);
    for (uint i = tid; i < len; i += tg_size) y[i] = x[i] * w[i] * inv;
}

// Single-threadgroup softmax with max-subtraction. dims = {len}.
kernel void softmax_f32(device const float* x   [[buffer(0)]],
                        device float*       y   [[buffer(1)]],
                        constant uint&      len [[buffer(2)]],
                        uint tid [[thread_position_in_threadgroup]],
                        uint tg_size [[threads_per_threadgroup]]) {
    threadgroup float partial[256];
    float m = -INFINITY;
    for (uint i = tid; i < len; i += tg_size) m = max(m, x[i]);
    partial[tid] = m;
    threadgroup_barrier(mem_flags::mem_threadgroup);
    for (uint s = tg_size / 2; s > 0; s >>= 1) {
        if (tid < s) partial[tid] = max(partial[tid], partial[tid + s]);
        threadgroup_barrier(mem_flags::mem_threadgroup);
    }
    float gmax = partial[0];
    threadgroup_barrier(mem_flags::mem_threadgroup);
    float sum = 0.0f;
    for (uint i = tid; i < len; i += tg_size) {
        float e = exp(x[i] - gmax);
        y[i] = e;
        sum += e;
    }
    partial[tid] = sum;
    threadgroup_barrier(mem_flags::mem_threadgroup);
    for (uint s = tg_size / 2; s > 0; s >>= 1) {
        if (tid < s) partial[tid] += partial[tid + s];
        threadgroup_barrier(mem_flags::mem_threadgroup);
    }
    float inv = 1.0f / partial[0];
    for (uint i = tid; i < len; i += tg_size) y[i] *= inv;
}
