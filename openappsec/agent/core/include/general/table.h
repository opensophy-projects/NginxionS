 

#ifndef __TABLE_H__
#define __TABLE_H__

#include <memory>

#include "i_table.h"
#include "i_environment.h"
#include "i_mainloop.h"
#include "i_time_get.h"
#include "singleton.h"
#include "component.h"

template <typename Key>
class Table
        :
    public Component,
    Singleton::Provide<I_Table>,
    Singleton::Provide<I_TableSpecific<Key>>,
    Singleton::Consume<I_Environment>,
    Singleton::Consume<I_TimeGet>,
    Singleton::Consume<I_MainLoop>
{
public:
    Table();
    ~Table();

    void init();
    void fini();
    void preload();

private:
    class Impl;
    std::unique_ptr<Impl> pimpl;
};

#include "table/table_impl.h"

#endif // __TABLE_H__
