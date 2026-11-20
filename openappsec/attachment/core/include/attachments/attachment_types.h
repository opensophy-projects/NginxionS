 

#ifndef __ATTACHMENT_TYPES_H__
#define __ATTACHMENT_TYPES_H__

#ifdef __cplusplus
enum class AttachmentType
#else // __cplusplus
enum AttachmentType
#endif
{
    NGINX_ATT_ID,
    PRELOAD_ATT_ID,
    SQUID_ATT_ID,
    ENVOY_ATT_ID,
#ifdef __cplusplus
    COUNT
#endif
};

#endif // __ATTACHMENT_TYPES_H__
