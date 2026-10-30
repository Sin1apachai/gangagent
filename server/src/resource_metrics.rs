use serde_json::{json, Value};
use std::{
    fs,
    sync::{Mutex, OnceLock},
    time::Instant,
};
#[derive(Default)]
struct Previous {
    vm: Option<(u64, u64)>,
    container: Option<(u64, Instant)>,
}
static PREVIOUS: OnceLock<Mutex<Previous>> = OnceLock::new();
fn read(path: &str) -> Option<String> {
    fs::read_to_string(path).ok()
}
fn number(path: &str) -> Option<u64> {
    read(path)?.trim().parse().ok()
}
fn field(text: &str, key: &str) -> Option<u64> {
    text.lines().find_map(|l| {
        let mut p = l.split_whitespace();
        if p.next()? == key {
            p.next()?.parse().ok()
        } else {
            None
        }
    })
}
fn percent(used: u64, total: u64) -> Option<f64> {
    if total == 0 {
        None
    } else {
        Some((100.0 * used as f64 / total as f64).clamp(0.0, 100.0))
    }
}
fn cpu_ticks(text: &str) -> Option<(u64, u64)> {
    let v = text
        .lines()
        .next()?
        .split_whitespace()
        .skip(1)
        .take(8)
        .map(str::parse::<u64>)
        .collect::<Result<Vec<_>, _>>()
        .ok()?;
    if v.len() < 5 {
        return None;
    }
    Some((v.iter().sum(), v[3] + v[4]))
}
fn cores(quota: &str, fallback: usize) -> f64 {
    let v = quota.split_whitespace().collect::<Vec<_>>();
    if v.len() == 2 {
        if let (Ok(q), Ok(p)) = (v[0].parse::<f64>(), v[1].parse::<f64>()) {
            if q > 0.0 && p > 0.0 {
                return q / p;
            }
        }
    }
    fallback.max(1) as f64
}
fn remaining(current: Option<u64>, explicit: Option<u64>, available: Option<u64>) -> Option<u64> {
    if let Some(limit) = explicit {
        current.map(|used| limit.saturating_sub(used))
    } else {
        available
    }
}
pub(crate) fn node() -> Value {
    collect().1
}
pub(crate) fn collect() -> (Value, Value) {
    let stat = read("/proc/stat").unwrap_or_default();
    let ticks = cpu_ticks(&stat);
    let cpu_count = stat
        .lines()
        .filter(|s| s.starts_with("cpu") && s.as_bytes().get(3).is_some_and(u8::is_ascii_digit))
        .count()
        .max(1);
    let mem = read("/proc/meminfo").unwrap_or_default();
    let total = field(&mem, "MemTotal:").and_then(|n| n.checked_mul(1024));
    let available = field(&mem, "MemAvailable:").and_then(|n| n.checked_mul(1024));
    let used = total.zip(available).map(|(t, a)| t.saturating_sub(a));
    let cg = read("/sys/fs/cgroup/cpu.stat").and_then(|s| field(&s, "usage_usec"));
    let now = Instant::now();
    let core_limit = cores(
        &read("/sys/fs/cgroup/cpu.max").unwrap_or_default(),
        cpu_count,
    );
    let mut prev = PREVIOUS
        .get_or_init(|| Mutex::new(Previous::default()))
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let vm_cpu = ticks.zip(prev.vm).and_then(|((t, i), (pt, pi))| {
        let dt = t.checked_sub(pt)?;
        let di = i.checked_sub(pi)?;
        percent(dt.saturating_sub(di), dt)
    });
    let node_cpu = cg.zip(prev.container).and_then(|(t, (pt, time))| {
        let dt = now.duration_since(time).as_secs_f64();
        if dt <= 0.0 {
            return None;
        }
        Some(
            ((t.checked_sub(pt)? as f64 / 1_000_000.0) / dt / core_limit * 100.0).clamp(0.0, 100.0),
        )
    });
    prev.vm = ticks;
    prev.container = cg.map(|t| (t, now));
    drop(prev);
    let current = number("/sys/fs/cgroup/memory.current");
    let explicit = number("/sys/fs/cgroup/memory.max");
    let limit = explicit.or(total);
    let node = json!({"cpu_percent":node_cpu,"cpu_limit_cores":core_limit,"memory_used_bytes":current,"memory_limit_bytes":limit,"memory_limit_explicit":explicit.is_some(),"memory_percent":current.zip(limit).and_then(|(u,t)|percent(u,t)),"memory_remaining_bytes":remaining(current,explicit,available),"pids_current":number("/sys/fs/cgroup/pids.current"),"pids_limit":number("/sys/fs/cgroup/pids.max"),"source":"linux_cgroup_v2"});
    (
        json!({"cpu_percent":vm_cpu,"cpu_count":cpu_count,"memory_total_bytes":total,"memory_available_bytes":available,"memory_used_bytes":used,"memory_percent":used.zip(total).and_then(|(u,t)|percent(u,t)),"source":"docker_linux_vm_proc_not_macos_host"}),
        node,
    )
}
pub(crate) fn disk(path: &str) -> Value {
    #[cfg(target_os = "linux")]
    {
        let Ok(path) = std::ffi::CString::new(path) else {
            return Value::Null;
        };
        let mut stat = std::mem::MaybeUninit::<libc::statvfs>::uninit();
        // statvfs initializes the structure only on success; path is a fixed, NUL-terminated path.
        if unsafe { libc::statvfs(path.as_ptr(), stat.as_mut_ptr()) } != 0 {
            return Value::Null;
        }
        let s = unsafe { stat.assume_init() };
        let total = (s.f_blocks as u64).saturating_mul(s.f_frsize as u64);
        let free = (s.f_bavail as u64).saturating_mul(s.f_frsize as u64);
        let used = total.saturating_sub(free);
        return json!({"total_bytes":total,"available_bytes":free,"used_bytes":used,"used_percent":percent(used,total),"filesystem_id":s.f_fsid,"source":"container_mounted_filesystem"});
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = path;
        Value::Null
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cpu_and_memory_parsers_preserve_unknowns() {
        assert_eq!(
            field("MemTotal: 100 kB\nMemAvailable: 40 kB", "MemAvailable:"),
            Some(40)
        );
        assert_eq!(field("", "MemTotal:"), None);
        assert_eq!(cpu_ticks("cpu 10 2 8 70 10 0 0 0 9 9"), Some((100, 80)));
        assert_eq!(percent(20, 100), Some(20.0));
        assert_eq!(percent(1, 0), None);
        assert_eq!(remaining(Some(10), Some(100), Some(20)), Some(90));
        assert_eq!(remaining(Some(10), None, Some(20)), Some(20));
        assert_eq!(remaining(None, Some(100), Some(20)), None);
        assert_eq!(cores("200000 100000", 8), 2.0);
        assert_eq!(cores("max 100000", 8), 8.0);
    }
    #[test]
    fn disk_counts_are_real_and_bounded() {
        let d = disk("/tmp");
        if !d.is_null() {
            assert!(d["total_bytes"].as_u64().unwrap() > 0);
            assert!(d["available_bytes"].as_u64().unwrap() <= d["total_bytes"].as_u64().unwrap());
        }
        assert!(disk("/nonexistent-agent-office-path").is_null());
    }
}
