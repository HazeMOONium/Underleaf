.PHONY: install dev lint test clean

install:
	cd backend && pip install -r requirements.txt
	cd frontend && npm install

dev:
	docker-compose up --build

lint:
	cd backend && black . && flake8 .
	cd frontend && npm run lint

test:
	cd backend && pytest

clean:
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	rm -rf frontend/node_modules
	rm -rf frontend/dist
