FROM php:8.4-cli-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends libpq-dev libsqlite3-dev \
    && docker-php-ext-install pdo_mysql pdo_pgsql pdo_sqlite \
    && rm -rf /var/lib/apt/lists/*

COPY app/src/ /opt/govern/app/src/
COPY docker/database-manager/ /opt/govern/docker/database-manager/

ENV DB_MANAGER_SOCKET=/run/govern-databases/provision.sock
WORKDIR /opt/govern
CMD ["php", "/opt/govern/docker/database-manager/server.php"]
