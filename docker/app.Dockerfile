FROM php:8.3-apache-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends mariadb-client \
    && docker-php-ext-install pdo_mysql \
    && rm -rf /var/lib/apt/lists/* \
    && sed -ri 's!/var/www/html!/var/www/public!g' /etc/apache2/sites-available/*.conf \
    && printf '\nServerName localhost\n' >> /etc/apache2/apache2.conf

COPY app/ /var/www/
COPY docker/database/20-govern.sql /var/www/workbench.sql
COPY docker/php.ini /usr/local/etc/php/conf.d/govern.ini
COPY docker/app-entrypoint.sh /usr/local/bin/govern-entrypoint
RUN chmod +x /usr/local/bin/govern-entrypoint

WORKDIR /var/www
ENTRYPOINT ["govern-entrypoint"]
CMD ["apache2-foreground"]
