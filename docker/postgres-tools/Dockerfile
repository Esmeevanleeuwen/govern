FROM postgres:18

# PostgreSQL 18 clients already come from the base image. Only Python is added
# from Debian; refreshing the unrelated PGDG package index is unnecessary.
RUN rm -f /etc/apt/sources.list.d/pgdg.list /etc/apt/sources.list.d/pgdg.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends python3 \
    && rm -rf /var/lib/apt/lists/*

COPY docker/postgres-tools/server.py /opt/govern/postgres-tools/server.py
ENV PG_TOOLS_SOCKET=/run/govern-postgres/tools.sock
ENTRYPOINT ["python3", "/opt/govern/postgres-tools/server.py"]
