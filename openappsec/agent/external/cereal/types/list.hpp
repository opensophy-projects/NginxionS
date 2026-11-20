/*! \file list.hpp
    \brief Support for types found in \<list\>
    \ingroup STLSupport */

#ifndef CEREAL_TYPES_LIST_HPP_
#define CEREAL_TYPES_LIST_HPP_

#include <cereal/cereal.hpp>
#include <list>

namespace cereal
{
  //! Saving for std::list
  template <class Archive, class T, class A> inline
  void CEREAL_SAVE_FUNCTION_NAME( Archive & ar, std::list<T, A> const & list )
  {
    ar( make_size_tag( static_cast<size_type>(list.size()) ) );

    for( auto const & i : list )
      ar( i );
  }

  //! Loading for std::list
  template <class Archive, class T, class A> inline
  void CEREAL_LOAD_FUNCTION_NAME( Archive & ar, std::list<T, A> & list )
  {
    size_type size;
    ar( make_size_tag( size ) );

    list.resize( static_cast<size_t>( size ) );

    for( auto & i : list )
      ar( i );
  }
} // namespace cereal

#endif // CEREAL_TYPES_LIST_HPP_
