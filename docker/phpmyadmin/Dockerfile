FROM phpmyadmin:5.2.3-apache

COPY docker/phpmyadmin/config.user.inc.php /etc/phpmyadmin/config.user.inc.php
COPY docker/phpmyadmin/init-storage.php /opt/govern/init-storage.php
COPY docker/phpmyadmin/entrypoint.sh /usr/local/bin/govern-phpmyadmin-entrypoint
RUN chmod +x /usr/local/bin/govern-phpmyadmin-entrypoint

ENTRYPOINT ["govern-phpmyadmin-entrypoint"]
CMD ["apache2-foreground"]
