 

#ifndef __IP_COMMON_C__
#define __IP_COMMON_C__

enum IpVersion {
    IP_VERSION_ANY = 0,
    IP_VERSION_4 = 4,
    IP_VERSION_6 = 6,
};

typedef enum IpVersion IpVersion;

typedef struct IpAddress {
    union {
        struct in_addr  ipv4;
        struct in6_addr ipv6;
    } ip;
#define addr4_t ip.ipv4
#define addr6_t ip.ipv6
    IpVersion ip_type;
} IpAddress;

typedef struct IPRange {
    IpAddress start;
    IpAddress end;
} IPRange;

typedef struct PortsRange {
    uint16_t start;
    uint16_t end;
} PortsRange;

typedef struct IpProtoRange {
    uint8_t start;
    uint8_t end;
} IpProtoRange;

typedef struct GDFilter {
    IPRange *source;
    unsigned int size;
} GDFilter;

#endif // __IP_COMMON_C__
