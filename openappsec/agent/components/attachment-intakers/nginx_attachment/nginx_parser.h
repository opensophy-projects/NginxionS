 

#ifndef __NGINX_PARSER_H__
#define __NGINX_PARSER_H__

#include <vector>

#include "compression_utils.h"
#include "nano_attachment_common.h"
#include "http_transaction_common.h"
#include "http_inspection_events.h"
#include "i_encryptor.h"

class NginxParser : Singleton::Consume<I_Encryptor>
{
public:
    static Maybe<HttpTransactionData> parseStartTrasaction(const Buffer &data);
    static Maybe<ResponseCode> parseResponseCode(const Buffer &data);
    static Maybe<uint64_t> parseContentLength(const Buffer &data);
    static Maybe<std::vector<HttpHeader>> parseRequestHeaders(
        const Buffer &data,
        const std::unordered_set<std::string> &ignored_headers
    );
    static Maybe<std::vector<HttpHeader>> parseResponseHeaders(const Buffer &data);
    static Maybe<HttpBody> parseRequestBody(const Buffer &data);
    static Maybe<HttpBody> parseResponseBody(
        const Buffer &raw_response_body,
        CompressionStream *compression_stream,
        CompressionType content_encoding
    );
    static Maybe<CompressionType> parseContentEncoding(const std::vector<HttpHeader> &headers);

    static Buffer tenant_header_key;

private:
    static Maybe<CompressionType> convertToContentEncoding(const Buffer &content_encoding_header_value);

    static std::map<Buffer, CompressionType> content_encodings;
};

#endif // __NGINX_PARSER_H__
