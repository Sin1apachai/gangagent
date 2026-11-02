use super::*;
#[derive(Clone, Deserialize, Serialize, Debug)]
#[serde(deny_unknown_fields)]
pub(crate) struct Manifest {
    pub schema: i32,
    pub runtime: String,
    pub source_dir: String,
    pub start_file: String,
    pub build_script: Option<String>,
    pub test_script: Option<String>,
    pub health_path: String,
}
pub(crate) fn relative(p: &str) -> bool {
    !p.is_empty()
        && p.len() <= 240
        && p.split('/').count() <= 8
        && p.split('/').all(|s| {
            !s.is_empty()
                && !s.starts_with('.')
                && !s.contains('\\')
                && s.chars().all(|c| !c.is_control() && c != ':' && c != '$')
        })
        && !std::path::Path::new(p).is_absolute()
}
impl Manifest {
    pub(crate) fn parse(bytes: &[u8]) -> std::result::Result<Self, String> {
        if bytes.len() > 8192 {
            return Err("office-run.json exceeds 8KB".into());
        }
        let m: Self = serde_json::from_slice(bytes)
            .map_err(|_| "office-run.json has invalid or unsupported fields")?;
        if m.schema != 1
            || m.runtime != "node"
            || !(m.source_dir == "." || relative(&m.source_dir))
            || !relative(&m.start_file)
            || !matches!(
                std::path::Path::new(&m.start_file)
                    .extension()
                    .and_then(|s| s.to_str()),
                Some("js" | "mjs" | "cjs")
            )
            || m.build_script.as_ref().is_some_and(|s| s != "build")
            || !m
                .test_script
                .as_ref()
                .is_some_and(|s| matches!(s.as_str(), "test" | "test:ci" | "test:smoke"))
            || !m.health_path.starts_with('/')
            || m.health_path.starts_with("//")
            || m.health_path.len() > 200
            || m.health_path
                .chars()
                .any(|c| c.is_control() || matches!(c, '\\' | '?' | '#' | ' '))
        {
            return Err(
                "Unsupported runtime manifest; use the bundled Node runtime standard".into(),
            );
        }
        Ok(m)
    }
}
pub(crate) fn permitted_file(name: &str) -> bool {
    relative(name)
        && !name.split('/').any(|s| {
            matches!(
                s,
                "node_modules" | "inputs" | "references" | ".git" | ".npmrc" | ".env"
            ) || (s.starts_with(".env.") && s != ".env.example")
        })
}
pub(crate) fn project(id: Uuid) -> String {
    format!("office-preview-{}", id.simple())
}
pub(crate) fn preview_url(id: Uuid, port: i32) -> String {
    format!("http://preview-{}.localhost:{port}", id.simple())
}
pub(crate) fn compose(id: Uuid, port: i32, m: &Manifest) -> Value {
    let p = project(id);
    let mut app = json!({"image":format!("{p}:local"),"build":{"context":".","dockerfile":"Dockerfile.office"},"command":["node",m.start_file],"user":"1000:1000","read_only":true,"tmpfs":["/tmp:rw,noexec,nosuid,size=67108864"],"cap_drop":["ALL"],"security_opt":["no-new-privileges:true"],"pids_limit":128,"mem_limit":"512m","cpus":1.0,"init":true,"restart":"no","environment":{"PORT":"3000","HOST":"0.0.0.0","NODE_ENV":"production","NPM_CONFIG_CACHE":"/tmp/npm-cache"},"ports":[format!("127.0.0.1:{port}:3000")],"volumes":[{"type":"volume","source":"work","target":"/workspace","read_only":true}],"labels":{"office.scope":"preview","office.job":id.to_string()},"logging":{"driver":"json-file","options":{"max-size":"2m","max-file":"1"}}});
    app.as_object_mut().unwrap().remove("ports");
    let gateway = json!({"image":"node:22-bookworm-slim","command":["node","-e",include_str!("../../standards/preview-gateway.cjs")],"user":"1000:1000","read_only":true,"cap_drop":["ALL"],"security_opt":["no-new-privileges:true"],"pids_limit":64,"mem_limit":"128m","cpus":0.25,"init":true,"restart":"no","environment":{"PREVIEW_HOST":format!("preview-{}.localhost:{port}",id.simple())},"ports":[format!("127.0.0.1:{port}:3000")],"depends_on":["app"],"networks":["default","edge"],"labels":{"office.scope":"preview","office.job":id.to_string(),"office.role":"gateway"},"logging":{"driver":"json-file","options":{"max-size":"2m","max-file":"1"}}});
    let mut builder = app.clone();
    let b = builder.as_object_mut().unwrap();
    b.remove("build");
    b.remove("ports");
    b.insert("network_mode".into(), json!("none"));
    b.insert("profiles".into(), json!(["build"]));
    b.insert("mem_limit".into(), json!("1g"));
    b.insert(
        "volumes".into(),
        json!([{"type":"volume","source":"work","target":"/workspace","read_only":false}]),
    );
    let mut workspace = builder.clone();
    let w = workspace.as_object_mut().unwrap();
    w.remove("profiles");
    w.insert("mem_limit".into(), json!("128m"));
    w.insert("cpus".into(), json!(0.1));
    w.insert("command".into(), json!(["node","-e","require('node:fs').cpSync('/opt/office-source','/workspace',{recursive:true}); require('node:fs').writeFileSync('/workspace/.office-source-ready','ready'); setInterval(()=>{},3600000)"]));
    w.insert("healthcheck".into(), json!({"test":["CMD","node","-e","require('node:fs').accessSync('/workspace/.office-source-ready')"],"interval":"1s","timeout":"2s","retries":10}));
    let mut installer = builder.clone();
    let i = installer.as_object_mut().unwrap();
    i.remove("network_mode");
    i.insert("profiles".into(), json!(["install"]));
    i.insert("networks".into(), json!(["edge"]));
    i.insert(
        "tmpfs".into(),
        json!(["/tmp:rw,noexec,nosuid,size=268435456"]),
    );
    i.insert(
        "command".into(),
        json!([
            "npm",
            "ci",
            "--include=dev",
            "--ignore-scripts",
            "--no-audit",
            "--no-fund"
        ]),
    );
    json!({"name":p,"services":{"app":app,"builder":builder,"gateway":gateway,"installer":installer,"workspace":workspace},"volumes":{"work":{"name":format!("{p}-work"),"driver":"local","driver_opts":{"type":"tmpfs","device":"tmpfs","o":"size=536870912,uid=1000,gid=1000,mode=0755"},"labels":{"office.scope":"preview","office.job":id.to_string()}}},"networks":{"edge":{"labels":{"office.scope":"preview","office.job":id.to_string()}},"default":{"internal":true,"labels":{"office.scope":"preview","office.job":id.to_string()}}}})
}
pub(crate) fn dockerfile(id: Uuid, _m: &Manifest) -> String {
    format!("FROM node:22-bookworm-slim\nWORKDIR /workspace\nRUN chown node:node /workspace\nUSER node\nCOPY --chown=node:node source/package.json source/package-lock.json /opt/office-source/\nCOPY --chown=node:node source/ /opt/office-source/\nLABEL office.scope=preview office.job={}\n",id)
}
#[cfg(test)]
mod tests {
    use super::*;
    fn good() -> Value {
        json!({"schema":1,"runtime":"node","source_dir":".","start_file":"server.mjs","build_script":null,"test_script":"test","health_path":"/"})
    }
    #[test]
    fn manifest_rejects_escape_and_extra_authority() {
        let mut v = good();
        assert!(Manifest::parse(&serde_json::to_vec(&v).unwrap()).is_ok());
        for key in ["source_dir", "start_file"] {
            v = good();
            v[key] = json!("../secret");
            assert!(Manifest::parse(&serde_json::to_vec(&v).unwrap()).is_err());
        }
        v = good();
        v["privileged"] = json!(true);
        assert!(Manifest::parse(&serde_json::to_vec(&v).unwrap()).is_err());
        v = good();
        v["health_path"] = json!("//host");
        assert!(Manifest::parse(&serde_json::to_vec(&v).unwrap()).is_err());
    }
    #[test]
    fn compose_exposes_only_loopback_and_no_host_mounts() {
        let id = Uuid::new_v4();
        let m = Manifest::parse(&serde_json::to_vec(&good()).unwrap()).unwrap();
        let c = compose(id, 19000, &m);
        let a = &c["services"]["app"];
        assert!(a.get("ports").is_none());
        assert_eq!(c["services"]["gateway"]["ports"][0], "127.0.0.1:19000:3000");
        assert_eq!(a["volumes"][0]["type"], "volume");
        assert_eq!(a["volumes"][0]["read_only"], true);
        assert!(a.get("privileged").is_none());
        assert_eq!(c["networks"]["default"]["internal"], true);
        assert!(c["services"]["installer"]["command"]
            .as_array()
            .unwrap()
            .contains(&json!("--ignore-scripts")));
        assert_eq!(c["volumes"]["work"]["driver_opts"]["type"], "tmpfs");
    }
}
