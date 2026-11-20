 

/// @file ngx_cp_http_parser.c
#include "ngx_cp_http_parser.h"

#include "ngx_cp_utils.h"

static const char *gzip_encoding_string = "gzip";
static const char *zlib_encoding_string = "deflate";
static const char *brotli_encoding_string = "br";
static const char *identity_encoding_string = "identity";

ngx_int_t
parse_content_encoding(CompressionType *response_encoding, const ngx_str_t *content_encoding_header_value)
{
    if (ngx_strcasecmp(content_encoding_header_value->data, (u_char*)gzip_encoding_string) == 0) {
        /// Sets GZIP encoding.
        *response_encoding = GZIP;
        return NGX_OK;
    }

    if (ngx_strcasecmp(content_encoding_header_value->data, (u_char*)zlib_encoding_string) == 0) {
        /// Sets GZIP encoding.
        *response_encoding = ZLIB;
        return NGX_OK;
    }

    if (ngx_strcasecmp(content_encoding_header_value->data, (u_char*)brotli_encoding_string) == 0) {
        /// Sets Brotli encoding.
        *response_encoding = BROTLI;
        return NGX_OK;
    }

    if (ngx_strcasecmp(content_encoding_header_value->data, (u_char*)identity_encoding_string) == 0) {
        /// Sets NO_COMPRESSION encoding.
        *response_encoding = NO_COMPRESSION;
        return NGX_OK;
    }

    write_dbg(
        DBG_LEVEL_WARNING,
        "Unsupported response content encoding: %.*s",
        content_encoding_header_value->len,
        content_encoding_header_value->data
    );
    return NGX_ERROR;
}

ngx_int_t
set_response_content_encoding(CompressionType *content_encoding, const ngx_table_elt_t *content_encoding_header)
{
    ngx_int_t parse_content_encoding_result;

    write_dbg(DBG_LEVEL_DEBUG, "Determining response body's content encoding");

    if (content_encoding_header == NULL) {
        *content_encoding = NO_COMPRESSION;
        write_dbg(DBG_LEVEL_DEBUG, "Response body is not encoded");

        return NGX_OK;
    }

    write_dbg(
        DBG_LEVEL_DEBUG,
        "Detected Content-Encoding header: key: %.*s, value: %.*s",
        content_encoding_header->key.len,
        content_encoding_header->key.data,
        content_encoding_header->value.len,
        content_encoding_header->value.data
    );
    /// Parses content header's value into content_encoding variable.
    parse_content_encoding_result = parse_content_encoding(content_encoding, &content_encoding_header->value);
    if (parse_content_encoding_result != NGX_OK) return NGX_ERROR;

    write_dbg(
        DBG_LEVEL_DEBUG,
        "Parsed content encoding: %.*s",
        content_encoding_header->value.len,
        content_encoding_header->value.data
    );

    return NGX_OK;
}
