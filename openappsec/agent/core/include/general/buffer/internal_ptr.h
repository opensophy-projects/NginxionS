 

#ifndef __BUFFER_INTERNAL_PTR_H__
#define __BUFFER_INTERNAL_PTR_H__

template <typename T>
class Buffer::InternalPtr
{
public:
    InternalPtr(const InternalPtr &) = default;
    InternalPtr(InternalPtr &&o) : ptr(o.ptr), ref(std::move(o.ref)) { o.ptr = nullptr; }
    InternalPtr & operator=(const InternalPtr &) = default;
    InternalPtr &
    operator=(InternalPtr &&o)
    {
        ptr = o.ptr;
        ref = std::move(o.ref);
        o.ptr = nullptr;

        return *this;
    }

    operator const T *() const { return ptr; }

    const T &
    operator*() const
    {
        dbgAssert(ptr != nullptr) << AlertInfo(AlertTeam::CORE, "buffer i/s") << "Accessing a moved pointer";
        return *ptr;
    }

    const T * operator->() const { return ptr; }

private:
    friend class Buffer;

    InternalPtr(const T *_ptr, const std::shared_ptr<DataContainer> &data) : ptr(_ptr), ref(data) {}
    template<typename O>
    InternalPtr(InternalPtr<O> &&other)
            :
        ptr(reinterpret_cast<const T *>(other.ptr)),
        ref(std::move(other.ref))
    {}

    const T *ptr;
    std::shared_ptr<DataContainer> ref;
};

#endif // __BUFFER_INTERNAL_PTR_H__
