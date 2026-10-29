FROM php:8.4-cli-bookworm

RUN docker-php-ext-install pdo_mysql

COPY app/src/ /opt/govern/app/src/
COPY docker/database-manager/ /opt/govern/docker/database-manager/

ENV DB_MANAGER_SOCKET=/run/govern-databases/provision.sock
WORKDIR /opt/govern
CMD ["php", "/opt/govern/docker/database-manager/server.php"]
