FROM mariadb:11.4

ENV TZ=UTC

COPY 99-timezone.cnf /etc/mysql/mariadb.conf.d/99-timezone.cnf

HEALTHCHECK --interval=30s --timeout=5s --retries=5 \
  CMD mariadb-admin ping -uroot -p"$MYSQL_ROOT_PASSWORD" || exit 1
