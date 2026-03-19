#!/bin/bash
# TLS Certificate Management Script
#
# Automates certificate renewal for Let's Encrypt using certbot.
# Supports both standalone and webroot modes.
#
# Usage:
#   ./scripts/tls-cert-manager.sh setup     # Initial setup
#   ./scripts/tls-cert-manager.sh renew    # Renew certificates
#   ./scripts/tls-cert-manager.sh check    # Check certificate status

set -e

# Configuration
DOMAIN="${DOMAIN:-localhost}"
EMAIL="${EMAIL:-admin@example.com}"
CERT_DIR="${CERT_DIR:-./certs}"
WEBROOT="${WEBROOT:-/var/www/certbot}"
STAGING="${STAGING:-false}"
DRY_RUN="${DRY_RUN:-false}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
  echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

# Check if certbot is installed
check_certbot() {
  if ! command -v certbot &> /dev/null; then
    log_error "certbot is not installed. Install with:"
    echo "  apt-get install certbot  # Debian/Ubuntu"
    echo "  yum install certbot      # RHEL/CentOS"
    echo "  brew install certbot     # macOS"
    exit 1
  fi
  log_info "certbot found: $(certbot --version)"
}

# Create certificate directory
setup_dirs() {
  mkdir -p "$CERT_DIR"
  mkdir -p "$WEBROOT"
  log_info "Created directories: $CERT_DIR, $WEBROOT"
}

# Initial certificate setup
setup_cert() {
  check_certbot
  setup_dirs

  local staging_arg=""
  local dry_run_arg=""

  if [ "$STAGING" = "true" ]; then
    staging_arg="--test-cert"
    log_warn "Using Let's Encrypt staging server"
  fi

  if [ "$DRY_RUN" = "true" ]; then
    dry_run_arg="--dry-run"
    log_warn "Dry run mode - certificates will not be issued"
  fi

  log_info "Setting up certificate for $DOMAIN"

  # Use standalone mode (requires port 80 to be free)
  certbot certonly \
    --standalone \
    --preferred-challenges http \
    --email "$EMAIL" \
    --agree-tos \
    --no-eff-email \
    -d "$DOMAIN" \
    $staging_arg \
    $dry_run_arg

  if [ $? -eq 0 ]; then
    # Copy certificates to app directory
    cp /etc/letsencrypt/live/$DOMAIN/fullchain.pem "$CERT_DIR/cert.pem"
    cp /etc/letsencrypt/live/$DOMAIN/privkey.pem "$CERT_DIR/key.pem"
    chmod 600 "$CERT_DIR/key.pem"
    log_info "Certificates copied to $CERT_DIR"
  else
    log_error "Certificate setup failed"
    exit 1
  fi
}

# Renew certificates
renew_cert() {
  check_certbot

  local dry_run_arg=""
  if [ "$DRY_RUN" = "true" ]; then
    dry_run_arg="--dry-run"
  fi

  log_info "Renewing certificates..."

  certbot renew $dry_run_arg

  if [ $? -eq 0 ]; then
    # Copy renewed certificates
    if [ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
      cp /etc/letsencrypt/live/$DOMAIN/fullchain.pem "$CERT_DIR/cert.pem"
      cp /etc/letsencrypt/live/$DOMAIN/privkey.pem "$CERT_DIR/key.pem"
      chmod 600 "$CERT_DIR/key.pem"
      log_info "Renewed certificates copied to $CERT_DIR"
    fi

    # Reload web server if running
    if command -v nginx &> /dev/null; then
      nginx -s reload 2>/dev/null || true
      log_info "nginx reloaded"
    fi
    if command -v systemctl &> /dev/null && systemctl is-active --quiet shipyard-cp; then
      systemctl reload shipyard-cp || true
      log_info "shipyard-cp reloaded"
    fi
  else
    log_error "Certificate renewal failed"
    exit 1
  fi
}

# Check certificate status
check_cert() {
  local cert_file="$CERT_DIR/cert.pem"

  if [ ! -f "$cert_file" ]; then
    log_warn "No certificate found at $cert_file"
    echo "Run: $0 setup"
    exit 0
  fi

  log_info "Certificate status for $DOMAIN:"

  # Get certificate expiry date
  local expiry_date
  expiry_date=$(openssl x509 -enddate -noout -in "$cert_file" | cut -d= -f2)

  # Calculate days until expiry
  local expiry_epoch
  local current_epoch
  expiry_epoch=$(date -d "$expiry_date" +%s 2>/dev/null || date -j -f "%b %d %T %Y %Z" "$expiry_date" +%s)
  current_epoch=$(date +%s)

  local days_remaining=$(( (expiry_epoch - current_epoch) / 86400 ))

  echo "  Expiry Date: $expiry_date"
  echo "  Days Remaining: $days_remaining"

  if [ $days_remaining -lt 7 ]; then
    log_error "Certificate expires in less than 7 days!"
    echo "Run: $0 renew"
  elif [ $days_remaining -lt 30 ]; then
    log_warn "Certificate expires in $days_remaining days"
    echo "Consider running: $0 renew"
  else
    log_info "Certificate is valid for $days_remaining more days"
  fi

  # Show certificate details
  echo ""
  echo "Certificate Details:"
  openssl x509 -in "$cert_file" -noout -subject -issuer
}

# Setup cron job for automatic renewal
setup_cron() {
  local cron_cmd="0 3 * * * $PWD/$0 renew >> /var/log/cert-renewal.log 2>&1"

  if crontab -l 2>/dev/null | grep -q "tls-cert-manager.sh renew"; then
    log_info "Cron job already exists"
  else
    log_info "Adding cron job for automatic renewal at 3 AM daily"
    (crontab -l 2>/dev/null; echo "$cron_cmd") | crontab -
    log_info "Cron job added"
  fi
}

# Generate self-signed certificate for development
generate_dev_cert() {
  log_warn "Generating self-signed certificate for development only!"
  mkdir -p "$CERT_DIR"

  openssl req -x509 -newkey rsa:4096 \
    -keyout "$CERT_DIR/key.pem" \
    -out "$CERT_DIR/cert.pem" \
    -days 365 -nodes \
    -subj "/CN=localhost/O=Development/C=US"

  chmod 600 "$CERT_DIR/key.pem"
  log_info "Self-signed certificate generated at $CERT_DIR"
  log_warn "This certificate is NOT valid for production!"
}

# Main
case "${1:-help}" in
  setup)
    setup_cert
    ;;
  renew)
    renew_cert
    ;;
  check)
    check_cert
    ;;
  cron)
    setup_cron
    ;;
  dev-cert)
    generate_dev_cert
    ;;
  help|*)
    echo "TLS Certificate Manager"
    echo ""
    echo "Usage: $0 <command>"
    echo ""
    echo "Commands:"
    echo "  setup     Initial certificate setup (Let's Encrypt)"
    echo "  renew     Renew certificates"
    echo "  check     Check certificate status and expiry"
    echo "  cron      Setup cron job for automatic renewal"
    echo "  dev-cert  Generate self-signed cert for development"
    echo ""
    echo "Environment Variables:"
    echo "  DOMAIN    Domain name (default: localhost)"
    echo "  EMAIL     Email for Let's Encrypt (default: admin@example.com)"
    echo "  CERT_DIR  Certificate directory (default: ./certs)"
    echo "  STAGING   Use Let's Encrypt staging (default: false)"
    echo "  DRY_RUN   Dry run mode (default: false)"
    ;;
esac