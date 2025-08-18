#!/bin/bash

# Police Bot Monitoring Script
# This script continuously monitors the police bot service health

# Configuration
TARGET_URL="${1:-https://police-bot-production.up.railway.app}"
CHECK_INTERVAL="${2:-300}"  # 5 minutes by default
LOG_FILE="monitoring.log"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a "$LOG_FILE"
}

check_health() {
    local url="$1"
    local endpoint="$2"
    local expected_status="$3"
    
    response=$(curl -s -w "%{http_code}" -o /dev/null "$url$endpoint" 2>/dev/null)
    
    if [ "$response" = "$expected_status" ]; then
        return 0
    else
        return 1
    fi
}

run_health_checks() {
    local failures=0
    
    echo -e "${YELLOW}Running health checks for: $TARGET_URL${NC}"
    
    # Basic health check
    if check_health "$TARGET_URL" "/health" "200"; then
        echo -e "${GREEN}✅ Health endpoint: OK${NC}"
    else
        echo -e "${RED}❌ Health endpoint: FAILED${NC}"
        ((failures++))
    fi
    
    # API health check
    if check_health "$TARGET_URL" "/api/health" "200"; then
        echo -e "${GREEN}✅ API Health endpoint: OK${NC}"
    else
        echo -e "${RED}❌ API Health endpoint: FAILED${NC}"
        ((failures++))
    fi
    
    # Browser status check
    if check_health "$TARGET_URL" "/api/browser-status" "200"; then
        echo -e "${GREEN}✅ Browser status endpoint: OK${NC}"
    else
        echo -e "${RED}❌ Browser status endpoint: FAILED${NC}"
        ((failures++))
    fi
    
    # CORS test
    if check_health "$TARGET_URL" "/api/cors-test" "200"; then
        echo -e "${GREEN}✅ CORS test endpoint: OK${NC}"
    else
        echo -e "${RED}❌ CORS test endpoint: FAILED${NC}"
        ((failures++))
    fi
    
    # Test submission endpoint
    test_response=$(curl -s -w "%{http_code}" -X POST "$TARGET_URL/api/police-form/submit" \
        -H "Content-Type: application/json" \
        -d '{"test": true}' 2>/dev/null | tail -n1)
    
    if [ "$test_response" = "200" ] || [ "$test_response" = "404" ]; then
        if [ "$test_response" = "200" ]; then
            echo -e "${GREEN}✅ Police form submit endpoint: OK${NC}"
        else
            echo -e "${YELLOW}⚠️  Police form submit endpoint: Not deployed yet (404)${NC}"
        fi
    else
        echo -e "${RED}❌ Police form submit endpoint: FAILED (HTTP $test_response)${NC}"
        ((failures++))
    fi
    
    return $failures
}

send_alert() {
    local message="$1"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    
    log "ALERT: $message"
    
    # You can add your notification logic here:
    # - Send email
    # - Post to Slack
    # - Send SMS
    # - Write to monitoring system
    
    echo -e "${RED}🚨 ALERT: $message${NC}"
}

main() {
    echo "🤖 Police Bot Monitoring Script"
    echo "Target URL: $TARGET_URL"
    echo "Check interval: ${CHECK_INTERVAL}s"
    echo "Log file: $LOG_FILE"
    echo "Starting monitoring... (Press Ctrl+C to stop)"
    echo "────────────────────────────────────────────────────────"
    
    consecutive_failures=0
    last_alert_time=0
    alert_cooldown=3600  # 1 hour cooldown between alerts
    
    while true; do
        current_time=$(date +%s)
        
        log "Starting health check cycle"
        
        if run_health_checks; then
            if [ $consecutive_failures -gt 0 ]; then
                log "Service recovered after $consecutive_failures failures"
                echo -e "${GREEN}🎉 Service recovered!${NC}"
            fi
            consecutive_failures=0
            log "All health checks passed"
        else
            failures=$?
            ((consecutive_failures++))
            
            log "Health check failed (failure count: $consecutive_failures)"
            
            # Send alert if we have 3 consecutive failures and cooldown has passed
            if [ $consecutive_failures -ge 3 ] && [ $((current_time - last_alert_time)) -gt $alert_cooldown ]; then
                send_alert "Police Bot service health check failed $consecutive_failures times. Service may be down."
                last_alert_time=$current_time
            fi
        fi
        
        echo "────────────────────────────────────────────────────────"
        echo "Next check in ${CHECK_INTERVAL}s..."
        sleep "$CHECK_INTERVAL"
    done
}

# Handle script termination
cleanup() {
    echo ""
    log "Monitoring stopped by user"
    echo "👋 Monitoring stopped. Check $LOG_FILE for full history."
    exit 0
}

trap cleanup SIGINT SIGTERM

# Validate URL format
if [[ ! "$TARGET_URL" =~ ^https?:// ]]; then
    echo "Error: Invalid URL format. Please provide a full URL (http:// or https://)"
    echo "Usage: $0 [URL] [CHECK_INTERVAL_SECONDS]"
    echo "Example: $0 https://police-bot-production.up.railway.app 300"
    exit 1
fi

# Start monitoring
main