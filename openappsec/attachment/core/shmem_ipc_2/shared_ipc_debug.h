 

#ifndef __SHARED_IPC_DEBUG_H__
#define __SHARED_IPC_DEBUG_H__

typedef struct LoggingData {
    int dbg_level;
    int worker_id;
    int fd;
} LoggingData;

extern void (*debug_int)(
    const LoggingData *loggin_data,
    uint32_t worker_id,
    int is_error,
    const char *func,
    const char *file,
    int line_num,
    const char *fmt,
    ...
);

#ifndef __FILENAME__
#define __FILENAME__ (strrchr(__FILE__, '/') ? strrchr(__FILE__, '/') + 1 : __FILE__)
#endif

enum debugLevel { TraceLevel = 0, DebugLevel = 1, WarningLevel = 3 };

#define writeDebug(logging_data, debug_level, fmt, ...) \
    {                                                   \
        debug_int(                                      \
            logging_data,                               \
            (logging_data)->worker_id,                  \
            debug_level,                                \
            __func__,                                   \
            __FILENAME__,                               \
            __LINE__,                                   \
            fmt,                                        \
            ##__VA_ARGS__                               \
        );                                              \
    }

#endif // __SHARED_IPC_DEBUG_H__
