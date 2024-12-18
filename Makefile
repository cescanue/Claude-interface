# Target por defecto
default: all

.PHONY: default all setup down fclean check-env

# Comprueba si existe el archivo .env
check-env:
	@if [ ! -f .env ]; then \
		echo "Error: .env file not found. Creating from template..."; \
		cp .env.example .env; \
	fi

# Crea los directorios necesarios
setup: check-env
	@mkdir -p data/postgres
	@mkdir -p logs/postgres
	@mkdir -p postgres/init
	@mkdir -p logs/node

# Inicia los contenedores
all: setup
	docker compose up -d --build

# Detiene los contenedores
down:
	docker compose down

# Limpia todo (contenedores, volúmenes y logs)
fclean: down
	@echo "Cleaning up containers, volumes and logs..."
	@rm -rf data
	@rm -rf logs
	@docker system prune -af

# Muestra los logs
logs:
	docker compose logs -f