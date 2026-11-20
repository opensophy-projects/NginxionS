 

#pragma once

#define BACKUP_DIRECTORY_PATH "/etc/cp/conf/waap/"
// reduce from 2048 in order to accomodate in 10K max log size in Kibana
#define MAX_LOG_FIELD_SIZE 1536
// maximum bytes response body log field size can reduce from request body log
#define MIN_RESP_BODY_LOG_FIELD_SIZE (std::size_t{500})
// size of clean values LRU cache
#define SIGS_APPLY_CLEAN_CACHE_CAPACITY 4096
// size of suspicious values LRU cache
#define SIGS_APPLY_SUSPICIOUS_CACHE_CAPACITY 4096
// size of SampleType cache capacity
#define SIGS_SAMPLE_TYPE_CACHE_CAPACITY 4096

// ScoreBuilder pool names
#define KEYWORDS_SCORE_POOL_BASE "base_scores"
#define KEYWORDS_SCORE_POOL_HEADERS "headers_scores"
