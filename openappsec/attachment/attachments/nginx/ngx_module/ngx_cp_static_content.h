 

/// @file ngx_cp_static_content.h
#ifndef __NGX_CP_STATIC_CONTENT_H__
#define __NGX_CP_STATIC_CONTENT_H__

#include <ngx_config.h>
#include <ngx_core.h>
#include <ngx_http.h>

#include "nano_attachment_common.h"

#define NOT_A_STATIC_RESOURCE NGX_DECLINED

///
/// @brief Initiates the static resources hash table.
/// @details Read the data from the static resources directory, load it into static_resources_hash_table.
/// @param[in, out] memory_pool NGINX pool used to allocate data into.
/// @returns ngx_int_t
///         - #NGX_OK
///         - #NGX_ERROR
///
ngx_int_t init_static_resources(ngx_pool_t *memory_pool);

///
/// @brief Returns if static resources hash has been initialized.
/// @returns ngx_int_t
///         - #1 Is intialized.
///         - #0 Is not intialized.
///
ngx_int_t is_static_resources_table_initialized(void);

///
/// @brief Handles a resource request.
/// @details Recieves a static resource name, get the data out of the static resource hash table and sends it.
/// @param[in] session_id Session ID, used for debug message.
/// @param[in, out] verdict Verdict to be returned back to the callee.
///         - #TRAFFIC_VERDICT_IRRELEVANT If the function returns a static resource.
/// @param[in, out] request NGINX request.
/// @return ngx_int_t
///         - #NOT_A_STATIC_RESOURCE
///         - #NGX_DONE
///
ngx_int_t handle_static_resource_request(
    uint32_t session_id,
    ServiceVerdict *verdict,
    ngx_http_request_t *request
);

#endif // __NGX_CP_STATIC_CONTENT_H__
