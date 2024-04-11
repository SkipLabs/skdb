
ARCH?=$(dpkg-architecture -qDEB_HOST_ARCH)
VERSION=1.7.3

.PHONY: clickhouse
clickhouse:
	sudo apt-get install -y apt-transport-https ca-certificates curl gnupg
	curl -fsSL 'https://packages.clickhouse.com/rpm/lts/repodata/repomd.xml.key' | sudo gpg --dearmor -o /usr/share/keyrings/clickhouse-keyring.gpg
	echo "deb [signed-by=/usr/share/keyrings/clickhouse-keyring.gpg] https://packages.clickhouse.com/deb stable main" | sudo tee \
    /etc/apt/sources.list.d/clickhouse.list
	sudo apt-get update
	sudo apt-get install -y clickhouse-server clickhouse-client
	sudo service clickhouse-server start
	clickhouse-client -q "CREATE DATABASE uptrace"

.PHONY: postgres
postgres:
	sudo apt-get postgresql
	sudo -u postgres psql -f postgres.sql

.PHONY: uptrace
uptrace:
	wget "https://github.com/uptrace/uptrace/releases/download/$(VERSION)/uptrace_$(VERSION)_$(ARCH).deb"
	sudo dpkg -i "uptrace_$(VERSION)_$(ARCH).deb"

.PHONY: install
install: clickhouse postgresql uptrace

uptrace.yml:
	wget https://raw.githubusercontent.com/uptrace/uptrace/master/config/uptrace.dist.yml -O uptrace.yml

.PHONY: start
start: uptrace.yml
	nohup uptrace --config=uptrace.yml serve > uptrace.log &

.PHONY: stop
stop:
	killall uptrace
	

	 

	

