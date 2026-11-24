 

// NginxionS: use a distinct guard for each IPC interface header.
#ifndef NGINXIONS_ATTACHMENT_SHMEM_IPC_H
#define NGINXIONS_ATTACHMENT_SHMEM_IPC_H

#include <stdint.h>
#include <sys/types.h>

#ifdef __cplusplus
extern "C"
{
#endif // __cplusplus

typedef struct SharedMemoryIPC SharedMemoryIPC;
extern const int corrupted_shmem_error;

SharedMemoryIPC * initIpc(
    const char queue_name[32],
    const uint32_t user_id,
    const uint32_t group_id,
    int is_owner,
    uint16_t num_of_queue_elem,
    void (*debug_func)(int is_error, const char *func, const char *file, int line_num, const char *fmt, ...)
);

void destroyIpc(SharedMemoryIPC *ipc, int is_owner);

int sendData(SharedMemoryIPC *ipc, const uint16_t data_to_send_size, const char *data_to_send);

int
sendChunkedData(
    SharedMemoryIPC *ipc,
    const uint16_t *data_to_send_sizes,
    const char **data_elem_to_send,
    const uint8_t num_of_data_elem
);

int receiveData(SharedMemoryIPC *ipc, uint16_t *received_data_size, const char **received_data);

int popData(SharedMemoryIPC *ipc);

int isDataAvailable(SharedMemoryIPC *ipc);

void resetIpc(SharedMemoryIPC *ipc, uint16_t num_of_data_segments);

void dumpIpcMemory(SharedMemoryIPC *ipc);

int isCorruptedShmem(SharedMemoryIPC *ipc, int is_owner);

uint16_t getSegmentEntrySize();

#ifdef __cplusplus
}
#endif // __cplusplus

#endif // NGINXIONS_ATTACHMENT_SHMEM_IPC_H
