

#ifndef __NGX_CP_ASYNC_BODY_H__
#define __NGX_CP_ASYNC_BODY_H__

#include <ngx_config.h>
#include <ngx_core.h>
#include <ngx_http.h>
#include <ngx_event.h>

ngx_int_t ngx_http_cp_res_body_filter_async(ngx_http_request_t *request, ngx_chain_t *body_chain);
ngx_int_t ngx_http_cp_req_body_filter_async(ngx_http_request_t *r, ngx_chain_t *in);

#endif // __NGX_CP_ASYNC_BODY_H__
