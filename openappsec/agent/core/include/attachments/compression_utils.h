 

#ifndef __COMPRESSION_UTILS_H__
#define __COMPRESSION_UTILS_H__

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C"
{
#endif // __cplusplus

typedef enum CompressionUtilsDebugLevel
{
    COMPRESSION_DBG_LEVEL_TRACE,
    COMPRESSION_DBG_LEVEL_DEBUG,
    COMPRESSION_DBG_LEVEL_INFO,
    COMPRESSION_DBG_LEVEL_WARNING,
    COMPRESSION_DBG_LEVEL_ERROR,
    COMPRESSION_DBG_LEVEL_ASSERTION
} CompressionUtilsDebugLevel;

void resetCompressionDebugFunctionsToStandardError();
void setCompressionDebugFunction(const CompressionUtilsDebugLevel debug_level, void (*debug_function)(const char *));

typedef struct CompressionStream CompressionStream;

typedef enum CompressionType
{
    NO_COMPRESSION,
    GZIP,
    ZLIB,
    BROTLI,
    UNKNOWN_COMPRESSION = NO_COMPRESSION
} CompressionType;

CompressionStream * initCompressionStream();
void finiCompressionStream(CompressionStream *compression_stream);

typedef struct CompressionResult
{
    int            ok;
    uint32_t       num_output_bytes;
    unsigned char *output;
} CompressionResult;

CompressionResult
compressData(
    CompressionStream *compression_stream,
    const CompressionType compression_type,
    const uint32_t uncompressed_data_size,
    const unsigned char *uncompressed_data,
    const int is_last_chunk
);

typedef struct DecompressionResult
{
    int            ok;
    uint32_t       num_output_bytes;
    unsigned char *output;
    int            is_last_chunk;
} DecompressionResult;

DecompressionResult
decompressData(
    CompressionStream *compression_stream,
    const uint32_t compressed_data_size,
    const unsigned char *compressed_data
);

DecompressionResult
decompressDataSafe(
    CompressionStream *compression_stream,
    const CompressionType compression_type,
    const uint32_t compressed_data_size,
    const unsigned char *compressed_data
);

#ifdef __cplusplus
}
#endif // __cplusplus

#endif // __COMPRESSION_UTILS_H__
