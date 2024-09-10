
ARCH?=$(dpkg-architecture -qDEB_HOST_ARCH)
VERSION=0.99.0

.PHONY: install
install:
	wget https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v$(VERSION)/otelcol_$(VERSION)_linux_$(ARCH).deb
	sudo dpkg -i otelcol_$(VERSION)_linux_$(ARCH).deb
	sudo cp config.yaml /etc/otelcol/config.yaml

.PHONY: start
start:
	sudo systemctl start otelcol

.PHONY: stop
stop:
	sudo systemctl stop otelcol