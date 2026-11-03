# Shared by the local HTTP listener and the opt-in private HTTPS upstream.
# Keep the browser's authority, including a published port, for same-origin
# requests and phpMyAdmin URLs. Only the enclosing listener sets the protocol.
absolute_redirect off;
client_max_body_size 128m;
add_header Cache-Control $govern_asset_cache_control always;

# The approved Govern session protects every native phpMyAdmin route,
# including uploads, AJAX requests and downloads.
location = /_govern_auth {
    internal;
    proxy_pass http://govern_app/auth-check.php;
    proxy_pass_request_body off;
    proxy_set_header Content-Length "";
    proxy_set_header Host $http_host;
    proxy_set_header Cookie $http_cookie;
    proxy_set_header X-Forwarded-Proto $govern_protocol;
}

location = /phpmyadmin {
    return 302 /phpmyadmin/;
}

location /phpmyadmin/ {
    auth_request /_govern_auth;
    error_page 401 = @govern_login;
    proxy_pass http://govern_phpmyadmin/;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-Proto $govern_protocol;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_cookie_path ~^/$ /phpmyadmin/;
    proxy_read_timeout 320s;
    proxy_redirect default;
}

location @govern_login {
    return 302 /auth.php?mode=login;
}

location / {
    proxy_pass http://govern_app/;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-Proto $govern_protocol;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_read_timeout 320s;
}
