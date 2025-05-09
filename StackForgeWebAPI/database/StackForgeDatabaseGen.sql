DROP TABLE IF EXISTS access_requests;
CREATE TABLE access_requests 
	(
        request_orgid TEXT,
		request_username TEXT, 
		request_timestamp DATE, 
		request_status TEXT
	); 
DROP INDEX IF EXISTS idx_access_requests; 
CREATE INDEX idx_access_requests ON access_requests (request_orgid, request_status, request_timestamp);

DROP TABLE IF EXISTS organizations;
CREATE TABLE organizations 
	(
    	orgid TEXT,
  		orgname TEXT, 
        orgemail TEXT, 
        orgphone TEXT, 
        orgdescription TEXT,
        orgimage TEXT,  
        created_at DATE
  	);
DROP INDEX IF EXISTS idx_organizations; 
CREATE INDEX idx_organizations ON organizations (orgid, created_at);

DROP TABLE IF EXISTS statuses; 
CREATE TABLE statuses 
    (
        software TEXT, 
        status TEXT
    ); 
DROP INDEX IF EXISTS idx_statuses; 
CREATE INDEX idx_statuses ON statuses (software, status);

DROP TABLE IF EXISTS status_updates; 
CREATE TABLE status_updates
    (
        software TEXT, 
        status TEXT, 
        timestamp TIMESTAMP,
        description TEXT, 
        issue_time TIMESTAMP,
        identified BOOL, 
        identified_at TIMESTAMP, 
        resolved BOOL, 
        resolved_at TIMESTAMP, 
        resolution_message TEXT
    ); 
DROP INDEX IF EXISTS idx_status_updates; 
CREATE INDEX idx_status_updates on status_updates (software, status, timestamp, resolved_at); 

DROP TABLE IF EXISTS error_logs; 
CREATE TABLE error_logs 
    (
        software TEXT, 
        route TEXT, 
        status_code INT, 
        message TEXT, 
        timestamp TIMESTAMP, 
        ip_address TEXT
    ); 
DROP INDEX IF EXISTS idx_error_logs; 
CREATE INDEX idx_error_logs ON error_logs (timestamp, status_code);

DROP TABLE IF EXISTS reset_logs;
CREATE TABLE reset_logs
	(
  		username TEXT, 
        reset_token TEXT, 
        expiration_timestamp TIMESTAMP, 
        timestamp TEXT,
        ip_address TEXT 
  	);
DROP INDEX IF EXISTS idx_reset_logs; 
CREATE INDEX idx_reset_logs ON reset_logs (username, expiration_timestamp);

DROP TABLE IF EXISTS signin_logs;
CREATE TABLE signin_logs
	(
        orgid TEXT, 
  		username TEXT, 
    	signin_timestamp DATE, 
        ip_address TEXT, 
        city TEXT, 
        region TEXT, 
        country TEXT, 
        zip TEXT, 
        lat FLOAT, 
        lon FLOAT, 
        timezone TEXT
  	);
DROP INDEX IF EXISTS idx_signin_logs; 
CREATE INDEX idx_signin_logs ON signin_logs (orgid, username, signin_timestamp);

DROP TABLE IF EXISTS permission_logs;
CREATE TABLE permission_logs
	(
        orgid TEXT, 
  		username TEXT, 
        changed_by TEXT, 
        permission TEXT, 
        old_value TEXT,
        new_value TEXT, 
        timestamp TIMESTAMP, 
        ip_address TEXT
    ); 
DROP INDEX IF EXISTS idx_permission_logs; 
CREATE INDEX idx_permission_logs ON permission_logs (orgid, username, changed_by, timestamp);

DROP TABLE IF EXISTS export_logs;
CREATE TABLE export_logs
	(
        orgid TEXT, 
  		username TEXT, 
        dataset TEXT,
        file_type TEXT, 
        timestamp TIMESTAMP, 
        ip_address TEXT
    ); 
DROP INDEX IF EXISTS idx_export_logs; 
CREATE INDEX idx_export_logs ON export_logs (orgid, username, dataset);

DROP TABLE IF EXISTS users;
CREATE TABLE users
	(
        orgid TEXT, 
  		username TEXT, 
        email TEXT, 
        phone TEXT,
        first_name TEXT, 
        last_name TEXT, 
        image TEXT,
        role TEXT, 
        salt TEXT, 
        hashed_password TEXT, 
        is_admin TEXT, 
        timezone TEXT,
        verified BOOL, 
        verification_token TEXT, 
        created_at DATE,
        twofaenabled BOOL, 
        multifaenabled BOOL, 
        loginnotisenabled BOOL, 
        exportnotisenabled BOOL, 
        datashareenabled BOOL, 
        showpersonalemail BOOL, 
        showpersonalphone BOOL, 
        showteamid BOOL, 
        showteamemail BOOL, 
        showteamphone BOOL, 
        showteamadminstatus BOOL, 
        showteamrole BOOL, 
        idekeybinds JSONB, 
        idezoomlevel FLOAT, 
        idecolortheme TEXT, 
        github_id TEXT, 
        github_username TEXT, 
        github_access_token TEXT,
        github_avatar_url TEXT 
  	); 
DROP INDEX IF EXISTS idx_users; 
CREATE INDEX idx_users ON users (orgid, username, created_at);

DROP TABLE IF EXISTS admins;
CREATE TABLE admins (
    username TEXT, 
    firstname TEXT,
    lastname TEXT,
    email TEXT, 
    phone TEXT, 
    roles TEXT
);
DROP INDEX IF EXISTS idx_admins; 
CREATE INDEX idx_admins ON admins (username, email);
INSERT INTO admins (username, firstname, lastname, email, phone, roles)
VALUES (
    'piacobelli', 
    'Peter', 
    'Iacobelli', 
    'peteriacobelli32@gmail.com', 
    '(803) 212-5172', 
    'Cofounder,CEO,CTO,COO'   
);

DROP TABLE IF EXISTS projects;
CREATE TABLE projects 
(
    orgid TEXT,
    username TEXT,
    project_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    branch TEXT,
    team_name TEXT,
    created_by TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL, 
    url TEXT, 
    repository TEXT,
    current_deployment TEXT, 
    previous_deployment TEXT,
    image TEXT
);
DROP INDEX IF EXISTS idx_projects;
CREATE INDEX idx_projects ON projects (orgid, username);

DROP TABLE IF EXISTS domains;
CREATE TABLE domains 
(
    orgid TEXT,
    username TEXT,
    domain_id TEXT PRIMARY KEY,
    domain_name TEXT NOT NULL,
    project_id TEXT,  
    deployment_id TEXT, 
    created_by TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL,
    is_accessible BOOLEAN DEFAULT FALSE,
    status_code INT,
    dns_records JSONB,
    checked_at TIMESTAMP,
    is_primary BOOLEAN DEFAULT FALSE,
    redirect_target TEXT, 
    environment TEXT, 
    repository TEXT,
    branch TEXT, 
    root_directory TEXT,
    install_command TEXT,
    build_command TEXT,
    output_directory TEXT,
    env_vars JSONB,
    ecs_service_name TEXT,
    certificate_arn TEXT, 
    target_group_arn TEXT,
    image_tag TEXT
);
DROP INDEX IF EXISTS idx_domains_orgid;
CREATE INDEX idx_domains_orgid ON domains (orgid, username);

DROP TABLE IF EXISTS deployments;
CREATE TABLE deployments 
(
    orgid TEXT,
    username TEXT,
    deployment_id TEXT PRIMARY KEY,
    project_id TEXT,  
    domain_id TEXT, 
    status TEXT NOT NULL,
    url TEXT NOT NULL,
    commit_sha VARCHAR(40),
    template TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL,
    last_deployed_at TIMESTAMP, 
    task_def_arn TEXT, 
    root_directory TEXT,
    output_directory TEXT,
    build_command TEXT,
    install_command TEXT,
    env_vars JSONB,
    target_group_arn TEXT,
    subdomain TEXT,
    image_tag TEXT

);
DROP INDEX IF EXISTS idx_deployments;
CREATE INDEX idx_deployments ON deployments (orgid, username);

DROP TABLE IF EXISTS deployment_logs;
CREATE TABLE deployment_logs
(
    orgid TEXT,
    username TEXT,
    project_name TEXT,
    project_id TEXT,
    action TEXT,
    deployment_id TEXT,
    timestamp TIMESTAMP,
    ip_address TEXT
);
DROP INDEX IF EXISTS idx_deployment_logs;
CREATE INDEX idx_deployment_logs ON deployment_logs (orgid, username);

DROP TABLE IF EXISTS build_logs; 
CREATE TABLE build_logs (
    orgid TEXT,
    username TEXT,
    deployment_id TEXT,
    build_log_id TEXT PRIMARY KEY,
    timestamp TIMESTAMP NOT NULL,
    log_path TEXT NOT NULL,
    log_messages TEXT NOT NULL
);
DROP INDEX IF EXISTS idx_build_logs;
CREATE INDEX idx_build_logs ON build_logs (orgid, username, deployment_id);

DROP TABLE IF EXISTS runtime_logs;
CREATE TABLE runtime_logs (
    orgid TEXT,
    username TEXT,
    deployment_id TEXT,
    build_log_id TEXT PRIMARY KEY,
    timestamp TIMESTAMP NOT NULL,
    status INTEGER,
    hostname VARCHAR(255),
    runtime_path TEXT NOT NULL,
    runtime_messages TEXT NOT NULL
);
DROP INDEX IF EXISTS idx_runtime_logs;
CREATE INDEX idx_runtime_logs ON build_logs (orgid, username, deployment_id);







