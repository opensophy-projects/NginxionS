 

#include "general_adaptor.h"
#include <stdlib.h>

void fw_kfree(void *addr, CP_MAYBE_UNUSED size_t size, CP_MAYBE_UNUSED const char *caller)
{
    free(addr);
    return;
}

void *fw_kmalloc(size_t size, CP_MAYBE_UNUSED const char *caller)
{
    return malloc(size);
}

void *fw_kmalloc_ex(size_t size, CP_MAYBE_UNUSED const char *caller, CP_MAYBE_UNUSED int flags)
{
    return malloc(size);
}

void *fw_kmalloc_sleep(size_t size, CP_MAYBE_UNUSED const char *caller)
{
    return malloc(size);
}

void *kiss_pmglob_memory_kmalloc_ex_(
    u_int size,
    CP_MAYBE_UNUSED const char *caller,
    CP_MAYBE_UNUSED int flags,
    CP_MAYBE_UNUSED const char *file,
    CP_MAYBE_UNUSED int line)
{
    return malloc(size);
}

void *kiss_pmglob_memory_kmalloc_ex(u_int size, CP_MAYBE_UNUSED const char *caller, CP_MAYBE_UNUSED int flags)
{
    return malloc(size);
}

void *kiss_pmglob_memory_kmalloc(u_int size, CP_MAYBE_UNUSED const char *caller)
{
    return malloc(size);
}

void kiss_pmglob_memory_kfree(void *addr, CP_MAYBE_UNUSED size_t size, CP_MAYBE_UNUSED const char *caller)
{
    free(addr);
    return;
}
